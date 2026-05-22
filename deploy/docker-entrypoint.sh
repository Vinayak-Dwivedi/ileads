#!/bin/sh
# Docker entrypoint script
set -e

# Run Prisma database migrations to ensure schema is up-to-date
echo "==> Running database migrations..."
if [ -n "$DATABASE_URL" ]; then
  npx prisma migrate deploy
else
  echo "WARNING: DATABASE_URL is not set. Skipping migrations."
fi

# Optional database seeding
if [ "$RUN_DB_SEED" = "true" ]; then
  echo "==> Running database seed..."
  if [ -n "$DATABASE_URL" ]; then
    npm run db:seed
  else
    echo "WARNING: DATABASE_URL is not set. Skipping seed."
  fi
fi

# Start the PM2 process manager in foreground (pm2-runtime)
echo "==> Starting application processes with PM2..."
exec pm2-runtime start ecosystem.config.js
