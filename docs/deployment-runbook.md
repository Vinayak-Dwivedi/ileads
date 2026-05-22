# Deployment Runbook — EC2 (one-shot bootstrap)

Deploy QMS to a fresh Ubuntu EC2 instance in **one command**. The script is
idempotent and safe to re-run.

## Requirements

| Resource | Minimum | Recommended |
| --- | --- | --- |
| Instance | `t3.small` (2 GB RAM) — auto-swap will let `t3.micro` work but the build is slow | `t3.medium` (4 GB RAM) for comfortable builds |
| Disk | 12 GB free (node_modules + .next + Postgres data + swap) | 20 GB+ |
| OS | Ubuntu 22.04 / 24.04 LTS (or Debian 12) | Ubuntu 24.04 LTS |
| Network | inbound 22 (ssh) + 80 (http) | + 443 if you terminate TLS on the box |

If total swap is < 2 GB, the bootstrap auto-creates a 4 GB `/swapfile` and
persists it in `/etc/fstab` with `vm.swappiness=10`. This is required —
Next 16's Turbopack build needs ~2 GB resident memory and t2/t3.micro ship
with 1 GB RAM and zero swap, which the kernel OOM-kills mid-build.

## Ownership model

`bootstrap-ec2.sh` runs as root via `sudo` but does **everything that
doesn't strictly need root as `$SUDO_USER`** (typically `ubuntu`):

- Root: `apt install`, NodeSource setup, swap creation, Postgres
  role/db provisioning, repo `chown -R`, nginx vhost install, `pm2 startup`
  systemd unit install.
- Deploy user: `npm ci`, `npx prisma`, `db:seed`, `next build`, `pm2 start`.

The repo is `chown -R $SUDO_USER` after the postgres step, so every
artifact the build/PM2 produce (`.next/`, `node_modules/`, `storage/`,
`runtime/`, `.env`) ends up owned by that user. After bootstrap, run
`bash deploy/redeploy.sh` (no sudo) for incremental redeploys. The
redeploy script refuses to run under sudo unless the repo is genuinely
root-owned, so you can't accidentally re-break ownership.

Override the deploy user explicitly with `DEPLOY_USER=foo sudo -E bash
deploy/bootstrap-ec2.sh`.

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
3. Creates a 4 GB `/swapfile` when total swap < 2 GB (persisted in
   `/etc/fstab`, `vm.swappiness=10`).
4. Loads `.env`. If missing, copies `.env.example` and **stops** — fill it
   in and re-run.
5. Generates a fresh `APP_SECRET` into `.env` when the value is empty / a
   placeholder / shorter than 32 chars.
6. Parses `DATABASE_URL`, creates the Postgres role + database, resets the
   role password, grants ownership, enables `pgcrypto`.
7. `chown -R $SUDO_USER` the repo so every later step runs as that user.
8. `npm ci`, `npx prisma generate`, `npx prisma migrate deploy` (as
   `$SUDO_USER`).
9. `npm run db:seed` + standard + Beetel parameter imports (as `$SUDO_USER`).
10. Builds Next.js with `NEXT_PUBLIC_BASE_PATH` from `.env` and
    `NODE_OPTIONS=--max-old-space-size=4096` (so V8 can use the swap).
11. Starts `ecosystem.config.js` under PM2 as `$SUDO_USER`, saves the
    process list, installs a `pm2-$SUDO_USER` systemd unit so PM2
    survives reboots.
12. Installs `deploy/nginx.conf` as a sites-enabled vhost and reloads nginx
    (refuses to clobber another `default_server` and explains how to merge
    the snippet instead).
13. Prints HEAD-request verification for upstream, nginx, and public IP.

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

- **`npm run build` says `Killed`** — kernel OOM-killed the build. Means
  swap wasn't set up or the heap cap wasn't raised. Re-run
  `sudo bash deploy/bootstrap-ec2.sh` (it'll add 4 GB swap + pass
  `NODE_OPTIONS=--max-old-space-size=4096`). For a manual recovery:

  ```bash
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  NODE_OPTIONS="--max-old-space-size=4096" npm run build
  ```
- **`EACCES: permission denied` on `.env` or `.next/`** — repo got
  root-owned. Means you ran `redeploy.sh` or `npm` under `sudo`. Fix:
  `sudo chown -R $USER:$USER /opt/qms` then re-run `bash deploy/redeploy.sh`
  without sudo.
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
