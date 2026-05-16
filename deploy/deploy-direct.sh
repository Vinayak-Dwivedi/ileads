#!/usr/bin/env bash
#
# Deploy / redeploy the QMS app on the host using direct Node.js + PM2.
#
#   bash deploy/deploy-direct.sh             # build + migrate + start/reload
#   bash deploy/deploy-direct.sh --seed      # also run npm run db:seed
#   bash deploy/deploy-direct.sh --no-build  # skip the build step (faster
#                                              redeploy when only code change
#                                              is config/env)
#
# Assumes:
#   - Node.js LTS (>= 22) installed
#   - PM2 installed globally (npm install -g pm2)
#   - PostgreSQL running and provisioned (run deploy/setup-postgres.sh first)
#   - .env populated with DATABASE_URL, APP_SECRET (>=16 chars), APP_PASSWORD,
#     NEXT_PUBLIC_BASE_PATH, APP_BASE_URL
#
# What it does:
#   1. npm install (production deps included)
#   2. npx prisma generate
#   3. npx prisma migrate deploy
#   4. (optional) npm run db:seed
#   5. NEXT_PUBLIC_BASE_PATH=/ileads-qms npm run build
#   6. pm2 reload ileads-qms   (or start if not running)
#   7. pm2 save
#   8. Print verification curl results.

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
APP_NAME="${APP_NAME:-ileads-qms}"

DO_SEED=0
DO_BUILD=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --seed)     DO_SEED=1 ;;
    --no-build) DO_BUILD=0 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
  shift
done

cd "$REPO_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: $REPO_DIR/.env not found. Copy .env.example to .env and fill it in." >&2
  exit 1
fi

# Read NEXT_PUBLIC_BASE_PATH from .env so the build matches deployment.
BASE_PATH=$(grep -E '^NEXT_PUBLIC_BASE_PATH=' .env | tail -1 | sed -E 's/^NEXT_PUBLIC_BASE_PATH=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')
BASE_PATH="${BASE_PATH:-/ileads-qms}"

echo "==> Repo:       $REPO_DIR"
echo "==> App name:   $APP_NAME"
echo "==> basePath:   ${BASE_PATH:-(empty)}"
export NODE_ENV=production
export NEXT_PUBLIC_BASE_PATH="$BASE_PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not installed. See docs/deployment-runbook.md." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm not installed." >&2
  exit 1
fi
if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: pm2 not installed. Run: sudo npm install -g pm2" >&2
  exit 1
fi

echo "==> Installing npm dependencies"
npm install --no-audit --no-fund

echo "==> Generating Prisma client"
npx prisma generate

echo "==> Applying migrations"
npx prisma migrate deploy

if [[ $DO_SEED -eq 1 ]]; then
  echo "==> Seeding database"
  npm run db:seed
fi

if [[ $DO_BUILD -eq 1 ]]; then
  echo "==> Building Next.js with basePath '$BASE_PATH'"
  NEXT_PUBLIC_BASE_PATH="$BASE_PATH" npm run build
else
  echo "==> Skipping build (--no-build)"
fi

# Reload PM2 process if it exists, otherwise start it. `pm2 reload` is a
# zero-downtime restart; `pm2 start` falls back to a fresh start.
echo "==> Starting/reloading PM2 process '$APP_NAME'"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 reload "$APP_NAME" --update-env
else
  # Use ecosystem-style start so PM2 reads env from .env via dotenv-cli is
  # avoided; we feed env explicitly so production-only values are correct.
  pm2 start npm \
    --name "$APP_NAME" \
    --cwd "$REPO_DIR" \
    --update-env \
    -- run start:prod
fi

pm2 save

echo ""
echo "==> Verification:"
sleep 2
set +e
curl -sI "http://127.0.0.1:3010${BASE_PATH}"        | head -1 | sed 's/^/    127.0.0.1:3010'"$BASE_PATH"'  -> /'
curl -sI "http://127.0.0.1:3010${BASE_PATH}/login"  | head -1 | sed 's/^/    127.0.0.1:3010'"$BASE_PATH"'/login -> /'
curl -sI "http://127.0.0.1${BASE_PATH}"              | head -1 | sed 's/^/    via-nginx '"$BASE_PATH"'        -> /' || true
echo ""
echo "Expected:"
echo "    127.0.0.1:3010${BASE_PATH}        -> HTTP/1.1 307"
echo "    127.0.0.1:3010${BASE_PATH}/login  -> HTTP/1.1 200"
echo ""
echo "If you haven't installed nginx yet, run:"
echo "    sudo bash deploy/install-nginx-direct.sh"
echo ""
echo "Useful PM2 commands:"
echo "    pm2 status"
echo "    pm2 logs $APP_NAME --lines 100"
echo "    pm2 restart $APP_NAME"
echo "    pm2 stop $APP_NAME"
