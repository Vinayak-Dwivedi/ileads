# Deployment Runbook — EC2 (one-shot bootstrap)

Deploy QMS to a fresh Ubuntu EC2 instance in **one command**. The script is
idempotent and safe to re-run.

## TL;DR

```bash
# 1. SSH into the box, clone the repo, copy .env
ssh ubuntu@<host>
git clone https://github.com/ileads-auxiliary-services/qms /opt/qms
cd /opt/qms
cp .env.example .env
$EDITOR .env       # fill in DATABASE_URL password, APP_PASSWORD, API keys

# 2. Run the bootstrap (installs Node 22, PM2, Postgres, nginx; provisions
#    the DB; runs migrations + seed; builds; starts under PM2; configures nginx)
sudo bash deploy/bootstrap-ec2.sh
```

That's it. Browse to `http://<host>/ileads-qms/login` and log in with
`APP_PASSWORD`.

## What `bootstrap-ec2.sh` does

1. Verifies it's running as root on an apt-based distro.
2. `apt install` system packages (Node 22 via NodeSource, PM2, PostgreSQL,
   nginx, ffmpeg, jq, build-essential, git, curl, ca-certificates, gnupg).
3. Loads `.env`. If it's missing, copies `.env.example` and **stops** — you
   must fill it in and re-run.
4. Generates a fresh `APP_SECRET` into `.env` only when the existing value
   is empty / a placeholder / shorter than 32 chars.
5. Parses `DATABASE_URL`, creates the Postgres role + database, resets the
   role password, grants ownership, enables `pgcrypto`.
6. `npm ci`, `npx prisma generate`, `npx prisma migrate deploy`.
7. Runs `npm run db:seed` plus the standard + Beetel parameter imports.
8. Builds Next.js with `NEXT_PUBLIC_BASE_PATH` taken from `.env`.
9. Starts `ecosystem.config.js` under PM2, saves the process list, installs
   a systemd unit so PM2 survives reboots.
10. Installs `deploy/nginx.conf` as a sites-enabled vhost and reloads nginx
    (refuses to clobber another `default_server` and explains how to merge
    the snippet instead).
11. Prints HEAD-request verification for upstream, nginx, and public IP.

## Flags

| Flag             | Effect |
| ---------------- | ------ |
| `--skip-system`  | Don't `apt install`. Use when Node/Postgres/nginx are pre-provisioned. |
| `--skip-seed`    | Skip `db:seed` and the parameter imports. Use for empty production deployments. |
| `--skip-nginx`   | Don't touch the nginx config. Use behind a managed load balancer / ALB. |
| `--skip-pm2`     | Don't start PM2. Use when running inside Docker. |
| `--no-build`     | Skip `npm run build`. Use after a manual build. |

## Required `.env` keys

The script reads these directly from `.env`:

| Key | Purpose |
| --- | --- |
| `DATABASE_URL` | `postgresql://user:pass@host:port/db?schema=public`. The script provisions the role + db when host is localhost. |
| `APP_SECRET` | Session signing key. Auto-generated when missing/placeholder. |
| `APP_PASSWORD` | Demo login password (single-tenant). |
| `NEXT_PUBLIC_BASE_PATH` | URL prefix baked into the bundle. Defaults to `/ileads-qms`. |
| `APP_BASE_URL` | Absolute public URL of the app. Used in OpenAPI + webhooks. |

Optional STT / LLM / storage keys are passed through unchanged — see
`.env.example` for the full list.

## Re-deploying after a git pull

```bash
cd /opt/qms
git pull
bash deploy/redeploy.sh           # install + migrate + build + pm2 reload
bash deploy/redeploy.sh --seed    # also re-seed (idempotent)
bash deploy/redeploy.sh --no-build # env-only change
bash deploy/redeploy.sh --pull    # convenience: git pull, then redeploy
```

`redeploy.sh` assumes `bootstrap-ec2.sh` has been run at least once.

## Diagnostics

```bash
bash deploy/diagnose.sh > /tmp/qms-diag.txt
```

Snapshots PM2 status + logs, `.env` (secrets redacted), Postgres service +
DB connection test, Prisma migration status, upstream/nginx HEAD requests,
nginx config dump, and the last nginx error log lines.

## Useful commands

```bash
pm2 status
pm2 logs ileads-web --lines 100
pm2 logs ileads-queue-worker --lines 100
pm2 reload ecosystem.config.js --update-env
sudo systemctl reload nginx
sudo systemctl restart postgresql
npx prisma migrate status
```

## Routing invariants — DO NOT BREAK

The Next.js bundle is built with `basePath=/ileads-qms`, so the upstream
**expects** the `/ileads-qms` prefix on every request, including
`/ileads-qms/_next/*`. `deploy/nginx.conf` reflects this:

- `location = /ileads-qms` → proxy (no 301 — Next's strict-slash policy
  would 308 back into a loop).
- `location ^~ /ileads-qms/` → prefix-passthrough proxy
  (`proxy_pass http://127.0.0.1:3010;` with no URI).
- `client_max_body_size 200M` so audio uploads aren't rejected at the
  edge before the app sees them.

If you need to merge the routes into an existing vhost instead, use
`deploy/nginx.snippet.conf`.

## Docker deploys (alternative path)

`Dockerfile` + `docker-compose.yml` ship the same app as a self-contained
container that runs PM2 + Next + queue worker. The container's entrypoint
(`deploy/docker-entrypoint.sh`) runs `prisma migrate deploy`, optionally
seeds, and execs `pm2-runtime`. Compose brings up a sidecar Postgres.

```bash
docker compose up -d --build
```

Use the bootstrap script for plain EC2 / VM deploys, and Docker compose
when you want a self-contained container.

## Troubleshooting

- **Bootstrap exits after creating `.env`** — that's expected on first run.
  Fill in the secrets and re-run `sudo bash deploy/bootstrap-ec2.sh`.
- **Nginx install skipped with a `default_server` warning** — another site
  on `:80` already owns `default_server`. Either disable it and re-run,
  or inline `deploy/nginx.snippet.conf` into that vhost.
- **`prisma migrate deploy` fails with `P1000`** — the Postgres role
  password in `DATABASE_URL` doesn't match the actual role password.
  Re-run the bootstrap; it will reset the role password from `.env`.
- **PM2 process restarting on every request** — `pm2 logs ileads-web`
  usually points at a missing env var (`APP_SECRET` empty, Sentry DSN
  malformed). Fix `.env` and `pm2 reload ecosystem.config.js --update-env`.
- **413 Request Entity Too Large** on audio upload — nginx
  `client_max_body_size` is too small. The shipped vhost sets `200M`;
  raise it and `sudo nginx -t && sudo systemctl reload nginx`.

## Audio + STT notes

- Local audio uploads are saved under `AUDIO_STORAGE_PATH` (default
  `./storage/audio`). The bootstrap creates this directory and chowns it
  to the deploy user.
- STT defaults to Deepgram (`STT_PROVIDER=deepgram`). For Sarvam or local
  Python STT, see `.env.example` and `stt/README.md`. The bootstrap does
  not download local model weights — run `scripts/stt/download-models.sh`
  manually if you need them.
- The OpenRouter audit pipeline receives transcript text only; raw audio
  never leaves the STT path.
