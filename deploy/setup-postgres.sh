#!/usr/bin/env bash
#
# Provision a local PostgreSQL database + role for the QMS app.
#
#   sudo bash deploy/setup-postgres.sh
#
# Idempotent — safe to re-run. Reads credentials from .env if present and
# never prints the password.
#
# What it does:
#   1. Verifies postgresql is installed and running.
#   2. Reads POSTGRES_DB, POSTGRES_USER, and POSTGRES_PASSWORD if supplied.
#      Otherwise reads DATABASE_URL from /root/qms_demo/.env.
#      Falls back to sensible ileads_qms / ileads_qms_user defaults, but
#      still requires a real password.
#   3. Creates the role + database if missing, sets the password, grants
#      ownership, enables pgcrypto for future UUID work.
#   4. Does NOT run migrations — see deploy-direct.sh for that.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: run as root (use sudo). Postgres role provisioning needs the postgres OS user." >&2
  exit 1
fi

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env}"

echo "==> Verifying PostgreSQL is installed"
if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not found. Install Postgres first:"
  echo "  sudo apt update"
  echo "  sudo apt install -y postgresql postgresql-contrib"
  exit 1
fi

echo "==> Verifying PostgreSQL service is active"
if ! systemctl is-active --quiet postgresql; then
  echo "    postgresql service is not active — starting it"
  systemctl start postgresql
  systemctl enable postgresql || true
fi

# ----- read credentials from explicit env vars or .env -----
DB_NAME="${POSTGRES_DB:-}"
DB_USER="${POSTGRES_USER:-}"
DB_PASS="${POSTGRES_PASSWORD:-}"
DB_HOST="localhost"
DB_PORT="5432"

if [[ -n "$DB_NAME" || -n "$DB_USER" || -n "$DB_PASS" ]]; then
  echo "==> Reading credentials from POSTGRES_* environment variables"
elif [[ -f "$ENV_FILE" ]]; then
  echo "==> Reading credentials from $ENV_FILE"
  DATABASE_URL_RAW=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | tail -1 | sed -E 's/^DATABASE_URL=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')
  if [[ -n "$DATABASE_URL_RAW" && "$DATABASE_URL_RAW" =~ ^postgres(ql)?://([^:]+):([^@]+)@([^:/]+)(:([0-9]+))?/([^?]+)(\?.*)?$ ]]; then
    DB_USER="${BASH_REMATCH[2]}"
    DB_PASS="${BASH_REMATCH[3]}"
    DB_HOST="${BASH_REMATCH[4]}"
    DB_PORT="${BASH_REMATCH[6]:-5432}"
    DB_NAME="${BASH_REMATCH[7]}"
  else
    echo "WARNING: DATABASE_URL in $ENV_FILE didn't parse — falling back to defaults"
  fi
else
  echo "==> No .env found at $ENV_FILE — using defaults"
fi

DB_NAME="${DB_NAME:-ileads_qms}"
DB_USER="${DB_USER:-ileads_qms_user}"

if [[ -z "$DB_PASS" || "$DB_PASS" == "CHANGE_ME" ]]; then
  echo "ERROR: DB password missing or still 'CHANGE_ME' in $ENV_FILE." >&2
  echo "       Edit DATABASE_URL with a real password before running this script." >&2
  exit 1
fi

if [[ "$DB_HOST" != "localhost" && "$DB_HOST" != "127.0.0.1" ]]; then
  echo "NOTE: DATABASE_URL host is $DB_HOST (not local). This script only"
  echo "      provisions a *local* Postgres. Skipping role/db creation."
  exit 0
fi

if [[ ! "$DB_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ || ! "$DB_USER" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
  echo "ERROR: database and user names must contain only letters, numbers, and underscores." >&2
  exit 1
fi

DB_PASS_SQL=${DB_PASS//\'/\'\'}

# We only print the user + db name. The password is never printed.
echo "    target: db='$DB_NAME', user='$DB_USER', host=$DB_HOST:$DB_PORT"

# ----- create role + db idempotently -----
PSQL='sudo -u postgres psql -v ON_ERROR_STOP=1 -q -At'

ROLE_EXISTS=$($PSQL -c "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'" || true)
if [[ -z "$ROLE_EXISTS" ]]; then
  echo "==> Creating role $DB_USER"
  $PSQL -c "CREATE ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASS_SQL';"
else
  echo "==> Role $DB_USER exists — updating password"
  $PSQL -c "ALTER ROLE \"$DB_USER\" WITH LOGIN PASSWORD '$DB_PASS_SQL';"
fi

DB_EXISTS=$($PSQL -c "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" || true)
if [[ -z "$DB_EXISTS" ]]; then
  echo "==> Creating database $DB_NAME owned by $DB_USER"
  $PSQL -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
else
  echo "==> Database $DB_NAME exists — ensuring ownership"
  $PSQL -c "ALTER DATABASE \"$DB_NAME\" OWNER TO \"$DB_USER\";"
fi

echo "==> Granting privileges + enabling extensions"
$PSQL -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO \"$DB_USER\";"
$PSQL -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

echo "==> Connection smoke test"
if PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c 'SELECT 1' >/dev/null 2>&1; then
  echo "    OK"
else
  echo "    WARN: could not connect as $DB_USER over TCP. Check pg_hba.conf"
  echo "          (it usually needs a 'host  $DB_NAME  $DB_USER  127.0.0.1/32  scram-sha-256' line)."
fi

echo ""
echo "Done. Next:"
echo "  cd $REPO_DIR"
echo "  npx prisma migrate deploy"
echo "  npm run db:seed"
