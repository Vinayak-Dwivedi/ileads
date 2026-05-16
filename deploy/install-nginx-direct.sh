#!/usr/bin/env bash
#
# Install the QMS Nginx server block on the production host.
#
#   sudo bash deploy/install-nginx-direct.sh
#
# Idempotent. Safe to re-run.
#
# Behaviour:
#   - Copies deploy/nginx.conf to /etc/nginx/sites-available/ileads-qms.conf
#   - Enables it via sites-enabled symlink
#   - Disables ONLY /etc/nginx/sites-enabled/default (stock Ubuntu site) when
#     no other default_server conflict is present
#   - Refuses to clobber if any other site is bound to `default_server` on
#     :80 and tells you what to do instead
#   - Validates with `nginx -t` and reloads on success
#
# After this, the public URL http://187.127.139.47/ileads-qms will work as
# long as the Next.js app is running on 127.0.0.1:3010 (managed by PM2 —
# see deploy/deploy-direct.sh).

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: run as root (use sudo)." >&2
  exit 1
fi

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
SRC="$SCRIPT_DIR/nginx.conf"
DEST_AVAIL="/etc/nginx/sites-available/ileads-qms.conf"
DEST_ENABLED="/etc/nginx/sites-enabled/ileads-qms.conf"
DEFAULT_SITE="/etc/nginx/sites-enabled/default"

if [[ ! -f "$SRC" ]]; then
  echo "ERROR: $SRC not found. Run from /root/qms_demo (or its checkout)." >&2
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "ERROR: nginx not installed. Install it first:"
  echo "  sudo apt update && sudo apt install -y nginx"
  exit 1
fi

echo "==> Scanning existing 'default_server' bindings on :80"
conflicts=$(
  grep -lEr 'listen[[:space:]]+([^;]*\s)?80([^;]*\s)?default_server' \
    /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null \
    | grep -v "^$DEFAULT_SITE$" \
    | grep -v "ileads-qms\.conf$" || true
)
if [[ -n "$conflicts" ]]; then
  echo "" >&2
  echo "WARNING: another nginx config also uses 'default_server' on :80:" >&2
  printf '    %s\n' $conflicts >&2
  echo "" >&2
  echo "Nginx only allows ONE default_server per listen address. You have two options:" >&2
  echo "  1) If those files are old/unused, disable them and re-run this script." >&2
  echo "  2) If they're another live app, install the location-only snippet into THAT" >&2
  echo "     server block instead — see deploy/nginx.snippet.conf." >&2
  echo "" >&2
  echo "Aborting before nginx -t (which would fail)." >&2
  exit 2
fi

echo "==> Installing $SRC -> $DEST_AVAIL"
install -m 0644 -D "$SRC" "$DEST_AVAIL"

if [[ -L "$DEST_ENABLED" && "$(readlink -f "$DEST_ENABLED")" == "$DEST_AVAIL" ]]; then
  echo "    already symlinked"
else
  ln -sf "$DEST_AVAIL" "$DEST_ENABLED"
  echo "    symlinked $DEST_ENABLED -> $DEST_AVAIL"
fi

if [[ -e "$DEFAULT_SITE" ]]; then
  echo "==> Disabling stock catch-all $DEFAULT_SITE"
  rm -f "$DEFAULT_SITE"
fi

echo "==> Running nginx -t"
nginx -t

echo "==> Reloading nginx"
systemctl reload nginx

echo "==> Done. Verifying upstream + public routing:"
sleep 1
set +e
echo ""
echo "  upstream (Next.js on 127.0.0.1:3010):"
curl -sI http://127.0.0.1:3010/ileads-qms      | head -1 | sed 's/^/    /'
curl -sI http://127.0.0.1:3010/ileads-qms/login | head -1 | sed 's/^/    /'
echo "  via nginx on the host:"
curl -sI http://127.0.0.1/ileads-qms            | head -1 | sed 's/^/    /'
curl -sI http://127.0.0.1/ileads-qms/login      | head -1 | sed 's/^/    /'
echo "  via public IP:"
curl -sI http://187.127.139.47/ileads-qms       | head -1 | sed 's/^/    /'

cat <<'EOTXT'

Expected:
  upstream 127.0.0.1:3010/ileads-qms  -> HTTP/1.1 307  (Next basePath OK)
  upstream 127.0.0.1:3010/ileads-qms/login -> HTTP/1.1 200
  via nginx /ileads-qms               -> HTTP/1.1 307
  via nginx /ileads-qms/login         -> HTTP/1.1 200

If 'upstream' is not 307, your Next.js process is down or wasn't built
with NEXT_PUBLIC_BASE_PATH=/ileads-qms. Fix with:
  cd /root/qms_demo
  bash deploy/deploy-direct.sh

If 'upstream' is 307 but the 'via nginx' lines are anything other than
HTTP/1.1 307/200, run:
  bash deploy/diagnose-direct.sh > /tmp/qms-diag.txt
EOTXT
