#!/usr/bin/env bash
#
# One-shot bootstrap for a fresh Ubuntu EC2 instance.
#
#   sudo bash deploy/bootstrap-ec2.sh
#
# Flags:
#   --skip-system     skip apt + nodesource + nginx + postgres install
#                     (use when those are already present and tested)
#   --skip-seed       skip `npm run db:seed` and the demo-parameter imports
#   --skip-nginx      skip the nginx site install + reload
#   --skip-pm2        skip PM2 setup (useful when running under docker)
#   --no-build        skip `npm run build` (use after manual deploy)
#
# What it does, idempotently:
#   1.  apt update + installs Node 22 (NodeSource), PM2, PostgreSQL, nginx,
#       ffmpeg, jq, build-essential, git, curl, ca-certificates, gnupg.
#   1b. Creates a 4 GB /swapfile when total swap < 2 GB (so the Turbopack
#       build doesn't get OOM-killed on t2/t3.micro).
#   2.  Loads .env (copies from .env.example and STOPS if missing — fill it
#       in and re-run).
#   3.  Generates a fresh APP_SECRET into .env if it's empty or a placeholder.
#   4.  Parses DATABASE_URL, creates the Postgres role + database, sets the
#       role password, grants privileges, enables pgcrypto.
#   4b. Chowns the entire repo to $DEPLOY_USER ($SUDO_USER) so every later
#       step runs as that user, not root.
#   5.  npm ci as $DEPLOY_USER.
#   6.  npx prisma generate + migrate deploy as $DEPLOY_USER.
#   7.  npm run db:seed + import:standard-parameters + import:beetel-parameters
#       as $DEPLOY_USER (skipped behind --skip-seed).
#   8.  next build with NEXT_PUBLIC_BASE_PATH from .env and
#       NODE_OPTIONS=--max-old-space-size=4096, as $DEPLOY_USER.
#   9.  Starts ecosystem.config.js under PM2 as $DEPLOY_USER, saves the
#       process list, installs the pm2-$DEPLOY_USER systemd unit.
#  10.  Installs deploy/nginx.conf as a sites-enabled vhost; reloads nginx.
#  11.  Prints verification HEAD requests.
#
# Safe to re-run. Designed for Ubuntu 22.04 / 24.04 (also works on Debian 12).
# Tested mental model: a fresh EC2 instance with only ssh access. Min size:
# t3.small. Smaller instances will work via the auto-swap, but the build is
# slow.

set -euo pipefail

# ----- argument parsing -----
SKIP_SYSTEM=0
SKIP_SEED=0
SKIP_NGINX=0
SKIP_PM2=0
DO_BUILD=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-system) SKIP_SYSTEM=1 ;;
    --skip-seed)   SKIP_SEED=1 ;;
    --skip-nginx)  SKIP_NGINX=1 ;;
    --skip-pm2)    SKIP_PM2=1 ;;
    --no-build)    DO_BUILD=0 ;;
    -h|--help)
      sed -n '2,40p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
  shift
done

# ----- ANSI helpers (only when stdout is a TTY) -----
if [[ -t 1 ]]; then
  BOLD=$'\e[1m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RED=$'\e[31m'; DIM=$'\e[2m'; RESET=$'\e[0m'
else
  BOLD=""; GREEN=""; YELLOW=""; RED=""; DIM=""; RESET=""
fi
log()  { printf '%s==> %s%s\n' "$BOLD" "$*" "$RESET"; }
note() { printf '%s    %s%s\n' "$DIM" "$*" "$RESET"; }
ok()   { printf '%s    ✓ %s%s\n' "$GREEN" "$*" "$RESET"; }
warn() { printf '%s    ! %s%s\n' "$YELLOW" "$*" "$RESET" >&2; }
die()  { printf '%sERROR:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

# Run a command as $DEPLOY_USER, preserving the env vars Node + Next + Prisma
# need. Pass-through when DEPLOY_USER is root. Use as:
#   as_user bash -c 'cd "$1" && npm ci' _ "$REPO_DIR"
#
# CRITICAL: -H resets HOME to $DEPLOY_USER's home. Without it sudo keeps
# the caller's $HOME (= /root when invoked via sudo from ubuntu) and npm
# tries to write its cache under /root/.npm, which the deploy user can't
# even traverse (/root is mode 700). Do NOT add HOME to --preserve-env.
# PATH is also left out so sudo's secure_path applies (covers
# /usr/bin, /usr/local/bin where node + npm + pm2 live).
as_user() {
  if [[ "$DEPLOY_USER" == "root" ]]; then
    "$@"
  else
    sudo -H -u "$DEPLOY_USER" \
      --preserve-env=NODE_ENV,NEXT_PUBLIC_BASE_PATH,NODE_OPTIONS \
      "$@"
  fi
}

# ----- preflight -----
if [[ $EUID -ne 0 ]]; then
  die "must be run as root (use sudo). Postgres role provisioning and nginx need root."
fi

if ! command -v apt-get >/dev/null 2>&1; then
  die "this script targets apt-based distros (Ubuntu / Debian). Use the manual runbook on other OSes."
fi

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
APP_NAME="${APP_NAME:-ileads-qms}"
DEPLOY_USER="${SUDO_USER:-root}"

cd "$REPO_DIR"
log "Repo: $REPO_DIR"
log "App:  $APP_NAME"
note "Running as: $(id -un)  (will own repo as: $DEPLOY_USER)"

# ----- 1. system packages -----
if [[ $SKIP_SYSTEM -eq 0 ]]; then
  log "Installing system packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y --no-install-recommends \
    curl ca-certificates gnupg build-essential git ffmpeg jq \
    nginx postgresql postgresql-contrib

  # NodeSource Node 22 LTS — only install if we don't already have node >= 22
  NEEDS_NODE=1
  if command -v node >/dev/null 2>&1; then
    cur=$(node -v | sed 's/^v//' | cut -d. -f1)
    if [[ "$cur" =~ ^[0-9]+$ && "$cur" -ge 22 ]]; then
      NEEDS_NODE=0
      note "node $(node -v) already installed"
    fi
  fi
  if [[ $NEEDS_NODE -eq 1 ]]; then
    log "Installing Node.js 22 LTS (NodeSource)"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
  ok "node $(node -v), npm $(npm -v)"

  # PM2 globally
  if ! command -v pm2 >/dev/null 2>&1; then
    log "Installing PM2 globally"
    npm install -g pm2
  fi
  ok "pm2 $(pm2 -v)"

  # Ensure postgres is running.
  systemctl enable --now postgresql >/dev/null 2>&1 || true
  systemctl is-active --quiet postgresql || die "postgresql failed to start. Check 'journalctl -u postgresql'."
  ok "postgresql active"
else
  note "Skipping system package install (--skip-system)"
fi

# ----- 1b. Swap (so Next.js / Turbopack builds don't OOM-kill) -----
# A Next 16 production build needs ~2 GB resident memory; default EC2
# t2/t3.micro AMIs ship with 1 GB RAM and zero swap, which kills the build.
TOTAL_SWAP_MB=$(free -m 2>/dev/null | awk '/^Swap:/ {print $2}')
if [[ "${TOTAL_SWAP_MB:-0}" -lt 2048 && ! -e /swapfile ]]; then
  log "Creating 4 GB /swapfile (existing swap = ${TOTAL_SWAP_MB:-0} MB)"
  fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
  ok "swap on — total now $(free -m | awk '/^Swap:/ {print $2}') MB"
else
  note "swap already ok (${TOTAL_SWAP_MB:-0} MB) — not creating /swapfile"
fi

# ----- 2. .env -----
ENV_FILE="$REPO_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$REPO_DIR/.env.example" ]]; then
    log "No .env found — copying .env.example"
    cp "$REPO_DIR/.env.example" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    warn ".env was just created from .env.example. Open it and fill in real"
    warn "values (DATABASE_URL password, APP_PASSWORD, API keys), then re-run."
    exit 2
  else
    die ".env missing and .env.example not found"
  fi
fi
chmod 600 "$ENV_FILE"
ok ".env present"

# Helper: extract a single quoted/unquoted value from .env (last write wins).
read_env() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" 2>/dev/null \
    | tail -1 \
    | sed -E "s/^${key}=//; s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/"
}

# Helper: set or insert a key=value pair in .env atomically.
set_env() {
  local key="$1" value="$2"
  local tmp="${ENV_FILE}.tmp.$$"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$value" '
      BEGIN{ FS=OFS="=" }
      $1==k { print k "=\"" v "\""; next }
      { print }
    ' "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp"
    printf '\n%s="%s"\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

# ----- 3. APP_SECRET -----
APP_SECRET_CUR="$(read_env APP_SECRET)"
if [[ -z "$APP_SECRET_CUR" || "$APP_SECRET_CUR" == "REPLACE_WITH_RANDOM_64_BYTE_VALUE" || ${#APP_SECRET_CUR} -lt 32 ]]; then
  log "Generating fresh APP_SECRET (>=64 bytes)"
  NEW_SECRET="$(openssl rand -base64 64 | tr -d '\n=' | tr '+/' '-_')"
  set_env APP_SECRET "$NEW_SECRET"
  ok "APP_SECRET written to .env"
else
  note "APP_SECRET already set, leaving as-is"
fi

# ----- 4. DATABASE_URL parsing + Postgres provisioning -----
DATABASE_URL_RAW="$(read_env DATABASE_URL)"
if [[ -z "$DATABASE_URL_RAW" ]]; then
  die "DATABASE_URL is empty in .env. Set it like: postgresql://user:pass@localhost:5432/ileads_qms?schema=public"
fi
if [[ ! "$DATABASE_URL_RAW" =~ ^postgres(ql)?://([^:]+):([^@]+)@([^:/]+)(:([0-9]+))?/([^?]+)(\?.*)?$ ]]; then
  die "DATABASE_URL didn't parse. Expected postgresql://USER:PASS@HOST:PORT/DB[?...]"
fi
DB_USER="${BASH_REMATCH[2]}"
DB_PASS="${BASH_REMATCH[3]}"
DB_HOST="${BASH_REMATCH[4]}"
DB_PORT="${BASH_REMATCH[6]:-5432}"
DB_NAME="${BASH_REMATCH[7]}"

if [[ ! "$DB_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  die "DB name must be [A-Za-z_][A-Za-z0-9_]* (got '$DB_NAME')"
fi
if [[ ! "$DB_USER" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  die "DB user must be [A-Za-z_][A-Za-z0-9_]* (got '$DB_USER')"
fi

log "Provisioning Postgres role + database"
note "target: db='$DB_NAME', user='$DB_USER', host=$DB_HOST:$DB_PORT"

if [[ "$DB_HOST" != "localhost" && "$DB_HOST" != "127.0.0.1" ]]; then
  warn "DB host is $DB_HOST — not local. Skipping role/db creation; ensure it"
  warn "exists and is reachable before continuing."
else
  # Single-quote escape for SQL literal (Postgres rule: '' for ').
  DB_PASS_SQL=${DB_PASS//\'/\'\'}
  PSQL=(sudo -u postgres psql -v ON_ERROR_STOP=1 -q -At)

  ROLE_EXISTS=$("${PSQL[@]}" -c "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'" || true)
  if [[ -z "$ROLE_EXISTS" ]]; then
    "${PSQL[@]}" -c "CREATE ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASS_SQL';"
    ok "role $DB_USER created"
  else
    "${PSQL[@]}" -c "ALTER ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASS_SQL';"
    note "role $DB_USER exists; password reset"
  fi

  DB_EXISTS=$("${PSQL[@]}" -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" || true)
  if [[ -z "$DB_EXISTS" ]]; then
    "${PSQL[@]}" -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
    ok "database $DB_NAME created"
  else
    "${PSQL[@]}" -c "ALTER DATABASE \"$DB_NAME\" OWNER TO \"$DB_USER\";"
    note "database $DB_NAME exists; ownership ensured"
  fi

  "${PSQL[@]}" -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO \"$DB_USER\";"
  "${PSQL[@]}" -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

  if PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
       -c 'SELECT 1' >/dev/null 2>&1; then
    ok "TCP connection as $DB_USER works"
  else
    warn "could not connect as $DB_USER over TCP. Check pg_hba.conf (a"
    warn "'host  $DB_NAME  $DB_USER  127.0.0.1/32  scram-sha-256' line is usually needed)."
  fi
fi

# ----- 4b. Hand the repo to the deploy user -----
# Everything below this point runs as $DEPLOY_USER via as_user, so the
# files it creates (node_modules/, .next/, storage/, runtime/, ~/.npm)
# must already be writeable by that user. The single recursive chown
# replaces the previous late, partial chown.
mkdir -p "$REPO_DIR/storage/audio" "$REPO_DIR/runtime/stt"
if [[ "$DEPLOY_USER" != "root" ]]; then
  log "Handing repo to $DEPLOY_USER (chown -R)"
  chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$REPO_DIR"
  chown "$DEPLOY_USER":"$DEPLOY_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  # Ensure the deploy user's home + npm cache are writeable by them.
  # If an earlier run did `sudo npm` without -H, root-owned files
  # ended up under ~ubuntu/.npm. as_user (with -H below) makes npm
  # use ~ubuntu/.npm, so heal it pre-emptively.
  DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
  DEPLOY_HOME="${DEPLOY_HOME:-/home/$DEPLOY_USER}"
  if [[ -d "$DEPLOY_HOME" ]]; then
    mkdir -p "$DEPLOY_HOME/.npm" "$DEPLOY_HOME/.cache"
    chown -R "$DEPLOY_USER":"$DEPLOY_USER" \
      "$DEPLOY_HOME/.npm" "$DEPLOY_HOME/.cache" 2>/dev/null || true
  fi
  ok "repo owned by $DEPLOY_USER, ~/.npm cache ready"
fi

# ----- 5. npm install (as deploy user) -----
log "Installing npm dependencies"
if [[ -f package-lock.json ]]; then
  as_user bash -c 'cd "$1" && npm ci --no-audit --no-fund' _ "$REPO_DIR"
else
  as_user bash -c 'cd "$1" && npm install --no-audit --no-fund' _ "$REPO_DIR"
fi
ok "npm dependencies installed"

# ----- 6. Prisma (as deploy user) -----
log "Generating Prisma client"
as_user bash -c 'cd "$1" && npx prisma generate' _ "$REPO_DIR"

log "Applying database migrations"
as_user bash -c 'cd "$1" && npx prisma migrate deploy' _ "$REPO_DIR"

# ----- 7. Seed + parameter imports (as deploy user) -----
if [[ $SKIP_SEED -eq 0 ]]; then
  log "Seeding database (npm run db:seed)"
  as_user bash -c 'cd "$1" && npm run db:seed' _ "$REPO_DIR"
  # Beetel + standard-parameters imports build on top of the seed and are
  # themselves idempotent. Optional for non-demo deployments.
  if npm run --silent 2>/dev/null | grep -qE '^\s+import:standard-parameters'; then
    log "Importing standard audit parameters"
    as_user bash -c 'cd "$1" && npm run import:standard-parameters' _ "$REPO_DIR"
  fi
  if npm run --silent 2>/dev/null | grep -qE '^\s+import:beetel-parameters'; then
    log "Importing Beetel demo parameter set"
    as_user bash -c 'cd "$1" && npm run import:beetel-parameters' _ "$REPO_DIR"
  fi
  ok "seed + parameter imports done"
else
  note "Skipping seed + parameter imports (--skip-seed)"
fi

# ----- 8. Build (as deploy user, with raised V8 heap) -----
BASE_PATH="$(read_env NEXT_PUBLIC_BASE_PATH)"
# ${VAR-default} (no colon) so an explicit NEXT_PUBLIC_BASE_PATH="" in .env
# stays empty for subdomain deploys. ${VAR:-default} would coerce empty back
# to /ileads-qms.
BASE_PATH="${BASE_PATH-/ileads-qms}"
export NEXT_PUBLIC_BASE_PATH="$BASE_PATH"
export NODE_ENV=production
# Lift V8 heap so the Turbopack build can actually use the RAM+swap we set
# up in step 1b. The default ~1.7 GB cap is what gets OOM-killed on micros.
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=4096"

if [[ $DO_BUILD -eq 1 ]]; then
  log "Building Next.js (basePath=${BASE_PATH:-(empty)}, heap=4096 MB)"
  as_user bash -c 'cd "$1" && npm run build' _ "$REPO_DIR"
  ok "build complete"
else
  note "Skipping build (--no-build)"
fi

# Drop NODE_OPTIONS from the parent shell so PM2 doesn't inherit it —
# the web + worker processes don't need 4 GB of heap.
unset NODE_OPTIONS

# ----- 9. PM2 (as deploy user) -----
if [[ $SKIP_PM2 -eq 0 ]]; then
  log "Starting/reloading PM2 ecosystem as $DEPLOY_USER"
  if as_user pm2 describe "$APP_NAME" >/dev/null 2>&1 \
     || as_user pm2 describe "ileads-web" >/dev/null 2>&1; then
    as_user bash -c 'cd "$1" && pm2 reload ecosystem.config.js --update-env' _ "$REPO_DIR"
  else
    as_user bash -c 'cd "$1" && pm2 start ecosystem.config.js --update-env' _ "$REPO_DIR"
  fi
  as_user pm2 save
  # Persist the PM2 daemon across reboots — `pm2 startup systemd` installs a
  # systemd unit that runs PM2 as $DEPLOY_USER. The install command itself
  # needs root, which is what we are.
  if command -v systemctl >/dev/null 2>&1; then
    DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
    DEPLOY_HOME="${DEPLOY_HOME:-/home/$DEPLOY_USER}"
    PM2_STARTUP_CMD=$(as_user pm2 startup systemd -u "$DEPLOY_USER" --hp "$DEPLOY_HOME" 2>&1 \
      | grep -E '^sudo env ' | tail -1 || true)
    if [[ -n "$PM2_STARTUP_CMD" ]]; then
      note "Installing PM2 systemd unit (pm2-$DEPLOY_USER)"
      eval "$PM2_STARTUP_CMD" || warn "pm2 startup install failed (non-fatal)"
    fi
  fi
  ok "PM2 ecosystem online"
else
  note "Skipping PM2 setup (--skip-pm2)"
fi

# ----- 10. Nginx -----
if [[ $SKIP_NGINX -eq 0 ]]; then
  log "Installing nginx vhost"
  NGINX_SRC="$SCRIPT_DIR/nginx.conf"
  NGINX_AVAIL="/etc/nginx/sites-available/${APP_NAME}.conf"
  NGINX_ENABLED="/etc/nginx/sites-enabled/${APP_NAME}.conf"
  DEFAULT_SITE="/etc/nginx/sites-enabled/default"

  [[ -f "$NGINX_SRC" ]] || die "$NGINX_SRC missing"

  # Extract the hostname from APP_BASE_URL so the vhost answers for the right
  # subdomain. Falls back to the public hostname if APP_BASE_URL is missing,
  # which keeps a fresh box reachable for first-time login at http://<ip>/.
  APP_BASE_URL_RAW="$(read_env APP_BASE_URL)"
  if [[ -n "$APP_BASE_URL_RAW" ]]; then
    SERVER_NAME="$(echo "$APP_BASE_URL_RAW" \
      | sed -E 's|^[a-z]+://||; s|/.*$||; s|:[0-9]+$||')"
  fi
  # `_` is nginx's "match any Host" placeholder — fine for first-time
  # bootstrap before DNS is set up; later runs read APP_BASE_URL and pin
  # the server_name to the real subdomain.
  SERVER_NAME="${SERVER_NAME:-_}"
  note "nginx server_name: $SERVER_NAME"

  # Render the vhost template (__SERVER_NAME__ -> $SERVER_NAME) to a temp
  # file so the source [deploy/nginx.conf] stays a clean template.
  RENDERED_VHOST="$(mktemp)"
  trap 'rm -f "$RENDERED_VHOST"' EXIT
  sed "s|__SERVER_NAME__|$SERVER_NAME|g" "$NGINX_SRC" > "$RENDERED_VHOST"

  install -m 0644 -D "$RENDERED_VHOST" "$NGINX_AVAIL"
  ln -sfn "$NGINX_AVAIL" "$NGINX_ENABLED"
  # Only remove the stock default site — never anything else.
  [[ -e "$DEFAULT_SITE" ]] && rm -f "$DEFAULT_SITE"
  nginx -t
  systemctl reload nginx
  ok "nginx vhost installed (server_name=$SERVER_NAME) and reloaded"
else
  note "Skipping nginx install (--skip-nginx)"
fi

# ----- 11. Verification -----
log "Verification"
sleep 2
set +e
HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
upstream_url="http://127.0.0.1:3010${BASE_PATH}"
print_curl() {
  local label="$1" url="$2"
  local code; code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null)
  printf '%s    %-12s %-50s %s%s\n' "$DIM" "$label" "$url" "$code" "$RESET"
}
print_curl upstream "$upstream_url"
print_curl upstream "${upstream_url}/login"
if [[ $SKIP_NGINX -eq 0 ]]; then
  print_curl nginx "http://127.0.0.1${BASE_PATH}"
  print_curl nginx "http://127.0.0.1${BASE_PATH}/login"
  [[ -n "$HOST_IP" ]] && print_curl public "http://$HOST_IP${BASE_PATH}"
fi
set -e

cat <<EOF

${BOLD}Done.${RESET}  ${DIM}Next steps:${RESET}
  ${DIM}— browse to:${RESET}  http://${HOST_IP:-<host>}${BASE_PATH}/login
  ${DIM}— log in with APP_PASSWORD from .env${RESET}
  ${DIM}— deploy/redeploy.sh           ${RESET}# re-run after a git pull
  ${DIM}— deploy/diagnose.sh           ${RESET}# full status snapshot
  ${DIM}— pm2 status / pm2 logs $APP_NAME${RESET}

EOF
