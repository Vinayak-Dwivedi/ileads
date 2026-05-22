#!/bin/sh
# Docker entrypoint for the container produced by Dockerfile.
#
# Env knobs (all optional except DATABASE_URL):
#   DATABASE_URL              required — Postgres connection string
#   RUN_DB_MIGRATE=true       run `npx prisma migrate deploy` (default: true)
#   RUN_DB_SEED=true          run `npm run db:seed` after migrations
#   RUN_PARAMETER_IMPORTS=true also run npm run import:{standard,beetel}-parameters
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

# Wait briefly for the DB host to accept connections — handles compose
# `depends_on` start-order races on cold boot.
if command -v nc >/dev/null 2>&1; then
  DB_HOSTPORT=$(echo "$DATABASE_URL" | sed -nE 's|.*@([^:/]+):?([0-9]*)/.*|\1 \2|p')
  DB_H=$(echo "$DB_HOSTPORT" | awk '{print $1}')
  DB_P=$(echo "$DB_HOSTPORT" | awk '{print $2}')
  : "${DB_P:=5432}"
  i=0
  while ! nc -z "$DB_H" "$DB_P" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -ge 30 ]; then
      echo "WARN: DB at $DB_H:$DB_P still not reachable after 30s — continuing anyway." >&2
      break
    fi
    sleep 1
  done
fi

RUN_DB_MIGRATE="${RUN_DB_MIGRATE:-true}"
if [ "$RUN_DB_MIGRATE" = "true" ]; then
  echo "==> Running database migrations..."
  npx prisma migrate deploy
fi

if [ "$RUN_DB_SEED" = "true" ]; then
  echo "==> Seeding database..."
  npm run db:seed
fi

if [ "$RUN_PARAMETER_IMPORTS" = "true" ]; then
  echo "==> Importing standard + Beetel parameters..."
  npm run import:standard-parameters || true
  npm run import:beetel-parameters || true
fi

echo "==> Starting application processes with PM2..."
exec pm2-runtime start ecosystem.config.js
