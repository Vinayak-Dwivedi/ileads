#!/usr/bin/env bash
#
# Re-deploy after a git pull on an already-bootstrapped EC2 host.
#
#   bash deploy/redeploy.sh             # install + migrate + build + reload
#   bash deploy/redeploy.sh --seed      # also run npm run db:seed
#   bash deploy/redeploy.sh --no-build  # skip the build (env-only change)
#   bash deploy/redeploy.sh --pull      # git pull origin <current-branch> first
#
# Assumes deploy/bootstrap-ec2.sh has been run at least once (Node, PM2,
# Postgres, nginx already in place).
#
# Steps:
#   1. (optional) git pull
#   2. npm ci (or npm install if no lockfile)
#   3. npx prisma generate
#   4. npx prisma migrate deploy
#   5. (optional) npm run db:seed
#   6. NEXT_PUBLIC_BASE_PATH=... npm run build
#   7. pm2 reload ecosystem.config.js --update-env
#   8. Verification HEAD requests.

set -euo pipefail

DO_PULL=0
DO_SEED=0
DO_BUILD=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pull)     DO_PULL=1 ;;
    --seed)     DO_SEED=1 ;;
    --no-build) DO_BUILD=0 ;;
    -h|--help)
      sed -n '2,25p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
  shift
done

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
APP_NAME="${APP_NAME:-ileads-qms}"
cd "$REPO_DIR"

# Refuse to run as root unless the repo is genuinely root-owned. Running
# redeploy.sh with sudo on a user-owned tree re-creates .next/ + npm cache
# as root and re-breaks subsequent non-sudo work. bootstrap-ec2.sh chowns
# the repo to $SUDO_USER specifically so this script runs as that user.
REPO_OWNER=$(stat -c '%U' "$REPO_DIR" 2>/dev/null || echo unknown)
if [[ $EUID -eq 0 && "$REPO_OWNER" != "root" ]]; then
  echo "ERROR: $REPO_DIR is owned by '$REPO_OWNER' but you're running as root." >&2
  echo "       Don't use sudo — re-run as that user:" >&2
  echo "         su - $REPO_OWNER -c 'cd $REPO_DIR && bash deploy/redeploy.sh $*'" >&2
  exit 1
fi

[[ -f .env ]] || { echo "ERROR: $REPO_DIR/.env missing. Run deploy/bootstrap-ec2.sh first." >&2; exit 1; }
[[ -r .env ]] || { echo "ERROR: $REPO_DIR/.env not readable as $(id -un). Check ownership/mode." >&2; exit 1; }

# Read NEXT_PUBLIC_BASE_PATH from .env so the build matches deployment.
BASE_PATH=$(grep -E '^NEXT_PUBLIC_BASE_PATH=' .env | tail -1 \
  | sed -E 's/^NEXT_PUBLIC_BASE_PATH=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')
# Use ${VAR-default} (no colon) so an explicit empty value in .env stays
# empty. With ${VAR:-default}, empty was being silently rewritten to the
# default and the build kept the old basePath.
BASE_PATH="${BASE_PATH-/ileads-qms}"

echo "==> Repo:      $REPO_DIR"
echo "==> App:       $APP_NAME"
echo "==> basePath:  ${BASE_PATH:-(empty)}"
export NODE_ENV=production
export NEXT_PUBLIC_BASE_PATH="$BASE_PATH"

command -v node >/dev/null 2>&1 || { echo "ERROR: node missing. Run deploy/bootstrap-ec2.sh first." >&2; exit 1; }
command -v pm2  >/dev/null 2>&1 || { echo "ERROR: pm2 missing.  Run deploy/bootstrap-ec2.sh first." >&2; exit 1; }

if [[ $DO_PULL -eq 1 ]]; then
  echo "==> git pull"
  git pull --ff-only
fi

echo "==> Installing npm dependencies"
if [[ -f package-lock.json ]]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

echo "==> Generating Prisma client"
npx prisma generate

echo "==> Applying migrations"
npx prisma migrate deploy

if [[ $DO_SEED -eq 1 ]]; then
  echo "==> Seeding database"
  npm run db:seed
fi

if [[ $DO_BUILD -eq 1 ]]; then
  # Lift V8 heap so the Turbopack build can use the available RAM+swap.
  # Default ~1.7 GB cap is what gets OOM-killed on small EC2 instances.
  echo "==> Building Next.js (basePath '$BASE_PATH', heap=4096 MB)"
  NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=4096" npm run build
else
  echo "==> Skipping build (--no-build)"
fi

echo "==> Reloading PM2"
if pm2 describe "$APP_NAME" >/dev/null 2>&1 || pm2 describe ileads-web >/dev/null 2>&1; then
  pm2 reload ecosystem.config.js --update-env
else
  pm2 start ecosystem.config.js --update-env
fi
pm2 save

echo ""
echo "==> Verification:"
sleep 2
set +e
curl -sI "http://127.0.0.1:3010${BASE_PATH}"       | head -1 | sed "s|^|    127.0.0.1:3010${BASE_PATH}       -> |"
curl -sI "http://127.0.0.1:3010${BASE_PATH}/login" | head -1 | sed "s|^|    127.0.0.1:3010${BASE_PATH}/login -> |"
curl -sI "http://127.0.0.1${BASE_PATH}"            | head -1 | sed "s|^|    via-nginx ${BASE_PATH}            -> |" || true

cat <<EOF

Expected:
  127.0.0.1:3010${BASE_PATH}        -> HTTP/1.1 307
  127.0.0.1:3010${BASE_PATH}/login  -> HTTP/1.1 200

If something is off:  bash deploy/diagnose.sh > /tmp/qms-diag.txt
PM2:  pm2 status  /  pm2 logs $APP_NAME --lines 100
EOF
