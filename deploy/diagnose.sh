#!/usr/bin/env bash
#
# Collect every diagnostic relevant to a QMS deployment (Node + PM2 +
# Postgres + nginx). Read-only — never edits config. Safe to re-run.
#
#   bash deploy/diagnose.sh                  # to stdout
#   bash deploy/diagnose.sh > /tmp/qms-diag.txt
#
# Designed for: copy-paste-run on the production host, paste the output back
# to the engineer working on the deployment.

set +e

H() { printf '\n========== %s ==========\n' "$*"; }
hide_secrets() {
  sed -E '
    s/(APP_SECRET=)[^[:space:]]+/\1<redacted>/;
    s/(APP_PASSWORD=)[^[:space:]]+/\1<redacted>/;
    s/(POSTGRES_PASSWORD=)[^[:space:]]+/\1<redacted>/;
    s/(DATABASE_URL=[^@]*:)[^@]+@/\1<redacted>@/;
    s/(OPENROUTER_API_KEY=)[^[:space:]]+/\1<redacted>/;
    s/(WHISPER_API_KEY=)[^[:space:]]+/\1<redacted>/;
  '
}

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
APP_NAME="${APP_NAME:-ileads-qms}"

# basePath from .env; empty for subdomain deploys, "/ileads-qms" for the
# legacy path-based layout. Empty default keeps probes pointed at the
# right URLs without per-deploy edits.
BASE_PATH=$(grep -E '^NEXT_PUBLIC_BASE_PATH=' "$REPO_DIR/.env" 2>/dev/null | tail -1 \
  | sed -E 's/^NEXT_PUBLIC_BASE_PATH=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')
APP_HOST=$(grep -E '^APP_BASE_URL=' "$REPO_DIR/.env" 2>/dev/null | tail -1 \
  | sed -E 's/^APP_BASE_URL=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/; s|^[a-z]+://||; s|/.*$||')

H "ENVIRONMENT"
echo "Hostname:    $(hostname -f 2>/dev/null || hostname)"
echo "IP addrs:    $(hostname -I 2>/dev/null)"
echo "Date:        $(date -Iseconds)"
echo "Repo dir:    $REPO_DIR"
echo "Repo HEAD:   $(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo '(not a git repo)')"

H "NODE / NPM / PM2"
echo "node:  $(node -v 2>&1)"
echo "npm:   $(npm -v 2>&1)"
echo "pm2:   $(pm2 -v 2>&1)"

H "PM2 STATUS"
pm2 status 2>&1 | sed -n '1,40p'

H "PM2 LOGS ($APP_NAME, last 80 lines)"
pm2 logs "$APP_NAME" --lines 80 --nostream 2>&1 | tail -80

H "ENV FILE (.env, secrets redacted)"
if [[ -f "$REPO_DIR/.env" ]]; then
  hide_secrets < "$REPO_DIR/.env"
else
  echo "NO .env AT $REPO_DIR/.env"
fi

H "POSTGRESQL SERVICE"
systemctl is-active postgresql 2>&1
systemctl status postgresql --no-pager 2>&1 | head -12

H "POSTGRESQL CONNECTION TEST"
DATABASE_URL_RAW=$(grep -E '^DATABASE_URL=' "$REPO_DIR/.env" 2>/dev/null | tail -1 | sed -E 's/^DATABASE_URL=//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')
if [[ -n "$DATABASE_URL_RAW" && "$DATABASE_URL_RAW" =~ ^postgres(ql)?://([^:]+):([^@]+)@([^:/]+)(:([0-9]+))?/([^?]+)(\?.*)?$ ]]; then
  DB_USER="${BASH_REMATCH[2]}"
  DB_PASS="${BASH_REMATCH[3]}"
  DB_HOST="${BASH_REMATCH[4]}"
  DB_PORT="${BASH_REMATCH[6]:-5432}"
  DB_NAME="${BASH_REMATCH[7]}"
  echo "Target: db=$DB_NAME user=$DB_USER host=$DB_HOST:$DB_PORT"
  if PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -At -c 'SELECT version()' >/dev/null 2>&1; then
    echo "Connection: OK"
    PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -At -c "SELECT 'tables=' || count(*) FROM information_schema.tables WHERE table_schema='public'"
  else
    echo "Connection: FAILED"
  fi
else
  echo "DATABASE_URL unparseable or missing"
fi

H "PRISMA MIGRATE STATUS"
( cd "$REPO_DIR" && npx prisma migrate status 2>&1 | head -40 )

H "UPSTREAM HEAD REQUESTS (Next.js on 127.0.0.1:3010)"
for path in / "${BASE_PATH}/login" "${BASE_PATH}/dashboard" ; do
  printf '%-30s -> ' "GET $path"
  curl -s -o /dev/null -w "%{http_code}  %{redirect_url}\n" "http://127.0.0.1:3010$path"
done

H "NGINX VERSION + STATUS"
nginx -v 2>&1
systemctl is-active nginx 2>&1

H "NGINX -T (head)"
nginx -T 2>&1 | head -120

H "NGINX sites-enabled"
ls -la /etc/nginx/sites-enabled 2>&1
echo
for f in /etc/nginx/sites-enabled/*; do
  printf '\n----- %s -----\n' "$f"
  if [[ -L "$f" ]]; then echo "(symlink -> $(readlink -f "$f"))"; fi
  cat "$f" 2>/dev/null | head -120
done

H "ileads-qms OCCURRENCES IN ACTIVE NGINX CONFIG"
nginx -T 2>/dev/null | grep -n 'ileads-qms' -C 3 | head -80

H "ALL default_server BINDINGS ON :80"
grep -nEr 'listen[[:space:]]+([^;]*\s)?80([^;]*\s)?default_server' \
  /etc/nginx/sites-enabled /etc/nginx/conf.d 2>&1 | head -20

H "PUBLIC HEAD REQUESTS (through nginx on 127.0.0.1:80, Host: ${APP_HOST:-(none)})"
HOST_HEADER=()
[[ -n "$APP_HOST" ]] && HOST_HEADER=(-H "Host: $APP_HOST")
for path in / "${BASE_PATH}/login" "${BASE_PATH}/dashboard" ; do
  printf '%-30s -> ' "GET $path"
  curl -s -o /dev/null "${HOST_HEADER[@]}" -w "%{http_code}  %{redirect_url}\n" "http://127.0.0.1$path"
done

H "PUBLIC HEAD REQUESTS (via public IP, no Host header)"
ip=$(hostname -I 2>/dev/null | awk '{print $1}')
if [[ -n "$ip" ]]; then
  for path in / "${BASE_PATH}/login" ; do
    printf '%-30s -> ' "GET http://$ip$path"
    curl -s -o /dev/null -w "%{http_code}  %{redirect_url}\n" "http://$ip$path"
  done
fi

H "_next ASSET ROUND-TRIP"
asset=$(curl -s "${HOST_HEADER[@]}" "http://127.0.0.1${BASE_PATH}/login" \
  | grep -oE "${BASE_PATH}/_next/static/[^\"]+" | head -1)
echo "discovered asset: $asset"
[ -n "$asset" ] && curl -s -o /dev/null "${HOST_HEADER[@]}" \
  -w "GET http://127.0.0.1$asset -> %{http_code}\n" "http://127.0.0.1$asset"

H "RECENT NGINX ERRORS"
journalctl -u nginx --no-pager -n 25 2>&1
echo
tail -25 /var/log/nginx/error.log 2>/dev/null

H "DONE"
echo "Paste this entire output back to the engineer."
