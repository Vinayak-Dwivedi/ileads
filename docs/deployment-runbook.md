# Deployment Runbook - `http://187.127.139.47/ileads-qms`

Run these commands on the production host. The repo path is assumed to be
`/root/qms_demo`.

## 1. Install System Packages

```bash
sudo apt update
sudo apt install -y curl ca-certificates nginx postgresql postgresql-contrib
```

## 2. Install Node.js LTS

Install Node.js 22 LTS or newer. One common Ubuntu path is NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

## 3. Install PostgreSQL

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

## 4. Create Database and User

Use these names:

```text
database: ileads_qms
user:     ileads_qms_user
```

Set a strong password in `.env` first:

```bash
cd /root/qms_demo
cp .env.example .env
$EDITOR .env
```

`DATABASE_URL` should look like:

```text
postgresql://ileads_qms_user:<password>@localhost:5432/ileads_qms?schema=public
```

If another local service already owns port `5432`, keep that service in place
and use the direct PostgreSQL cluster port in `.env` instead. On the current
host, QMS uses `localhost:5433` because `5432` is already occupied by another
app.

Provision the role and database:

```bash
sudo bash deploy/setup-postgres.sh
```

The script is safe to rerun. It reads `.env`, creates the role/database when
missing, updates the role password, grants privileges, and enables `pgcrypto`.

## 5. Configure `.env`

Production values:

```text
DATABASE_URL="postgresql://ileads_qms_user:<password>@localhost:5432/ileads_qms?schema=public"
APP_SECRET="<long random secret>"
APP_PASSWORD="<seed login password>"
NEXT_PUBLIC_BASE_PATH="/ileads-qms"
APP_BASE_URL="http://187.127.139.47/ileads-qms"
NODE_ENV="production"
MOCK_STT=false
SHOW_MOCK_ACTIONS=false
STT_PROVIDER=sarvam
```

Generate a secret with:

```bash
openssl rand -base64 32
```

## 6. Install NPM Dependencies

```bash
cd /root/qms_demo
npm install
```

## 7. Generate Prisma Client

```bash
npx prisma generate
```

## 8. Run Migrations

```bash
npx prisma migrate deploy
```

## 9. Seed Database

Run once for demo data or when intentionally refreshing seed content:

```bash
npm run db:seed
```

## 10. Build Next.js With Base Path

The base path is baked into the production bundle:

```bash
NEXT_PUBLIC_BASE_PATH=/ileads-qms npm run build
```

## 11. Start App With PM2

Install PM2:

```bash
sudo npm install -g pm2
```

Start the app on `127.0.0.1:3010`:

```bash
pm2 start npm --name ileads-qms -- run start:prod
pm2 save
pm2 startup
```

The package script is:

```json
"start:prod": "next start -H 127.0.0.1 -p 3010"
```

For repeat deployments, use:

```bash
cd /root/qms_demo
bash deploy/deploy-direct.sh
```

Seed during deployment only when needed:

```bash
bash deploy/deploy-direct.sh --seed
```

## 12. Configure Nginx

Install the direct reverse-proxy config:

```bash
cd /root/qms_demo
sudo bash deploy/install-nginx-direct.sh
```

The installed server block proxies:

```text
/                 -> 302 /ileads-qms
/ileads-qms       -> http://127.0.0.1:3010
/ileads-qms/*     -> http://127.0.0.1:3010
```

If another active site already owns the default `:80` server, the installer
prints a warning and stops before changing that app. In that case, merge the
`/ileads-qms` locations into the existing server block.

## 13. Verify Public URL

On the host:

```bash
curl -I http://127.0.0.1:3010/ileads-qms
curl -I http://127.0.0.1:3010/ileads-qms/login
curl -I http://127.0.0.1/ileads-qms
curl -I http://187.127.139.47/ileads-qms
```

Expected:

```text
127.0.0.1:3010/ileads-qms       -> 307 to /ileads-qms/dashboard
127.0.0.1:3010/ileads-qms/login -> 200
127.0.0.1/ileads-qms            -> 307 to /ileads-qms/dashboard
187.127.139.47/ileads-qms       -> 307 to /ileads-qms/dashboard
```

Browser flow:

1. Open `http://187.127.139.47/ileads-qms`.
2. Sign in with `APP_PASSWORD`.
3. Check Dashboard, Calls, Parameters, Clients, and Settings.
4. Run the mock audit action on a call detail page.
5. Confirm URLs do not contain `/ileads-qms/ileads-qms`.

## 14. Restart Commands

```bash
pm2 restart ileads-qms
pm2 reload ileads-qms --update-env
pm2 stop ileads-qms
pm2 start npm --name ileads-qms -- run start:prod
sudo systemctl reload nginx
sudo systemctl restart postgresql
```

## 15. Logs and Troubleshooting

Direct diagnostics:

```bash
bash deploy/diagnose-direct.sh > /tmp/qms-diag.txt
cat /tmp/qms-diag.txt
```

Useful manual checks:

```bash
pm2 status
pm2 logs ileads-qms --lines 100
systemctl status postgresql
npx prisma migrate status
sudo nginx -t
sudo nginx -T | grep -n ileads-qms
sudo tail -80 /var/log/nginx/error.log
```

Common issues:

- Nginx 404: active Nginx config is missing the `/ileads-qms` proxy block.
- Next.js 404: the app was built without `NEXT_PUBLIC_BASE_PATH=/ileads-qms`.
- Static asset 404: Nginx is not proxying `/ileads-qms/_next/*` to Node.
- Login loops: verify `APP_SECRET` is stable and PM2 was restarted after env
  changes.
- DB errors: verify `DATABASE_URL`, PostgreSQL status, and
  `npx prisma migrate status`.

## Upload Troubleshooting

- **HTTP 413 (Request Entity Too Large)** on `POST /ileads-qms/api/calls/upload`
  means Nginx is rejecting the body before it reaches Node. Increase
  `client_max_body_size` in the active vhost (snippet below) — the app's
  `MAX_AUDIO_UPLOAD_MB` is irrelevant until Nginx accepts the body.
- The active vhost for `/ileads-qms` is
  `/etc/nginx/sites-available/zepto-vb-demo.conf` (symlinked into
  `sites-enabled/`). It sets `client_max_body_size 500M` at the server level
  *and* inside both `/ileads-qms` location blocks, with 300s proxy timeouts so
  large WAVs don't get cut off mid-upload.
- Inspect the active limit:

  ```bash
  sudo nginx -T | grep -n "client_max_body_size" -C 10
  ```

- Reload after editing:

  ```bash
  sudo nginx -t && sudo systemctl reload nginx
  ```

- App-level cap is `MAX_AUDIO_UPLOAD_MB` in `.env` (currently `250`). The
  upload dialog reads this from the calls page and rejects oversize files
  client-side with a clear message; the `/api/calls/upload` route also enforces
  it via `saveAudioFile()`.

## AI Pipeline Note

Sarvam Batch STT and OpenRouter/Gemma live audit are implemented. Keep
`MOCK_STT=false` and `SHOW_MOCK_ACTIONS=false` for the production demo.

For demo data, import existing local audio from `AUDIO_STORAGE_PATH` with:

```bash
npm run import:audio
```

This creates one pending call per unlinked audio file and does not move,
delete, or overwrite the recordings. Use call detail's live transcription and
AI audit actions for the demo. Raw audio goes only to the STT layer; OpenRouter
receives transcript text only.
