# AWS EC2 — From Scratch (native, single box)

Step-by-step guide to put iLeads QMS on a **brand-new** AWS EC2 instance, with
everything running directly on the box: Node + PM2 (web + worker), PostgreSQL,
and nginx. No Docker, no RDS. This is the simplest production-capable setup.

> Already SSH'd into a server? Skip to step 5, or just read
> [`deployment-runbook.md`](deployment-runbook.md) — `bootstrap-ec2.sh` does
> the heavy lifting. This doc adds the AWS-console steps before that.

The end result: the app served at `http://<your-ec2-ip>/` and login with
`APP_PASSWORD`.

---

## 0. Prerequisites (one-time, on your Windows machine)

- An **AWS account** (https://aws.amazon.com → Create account).
- Your code pushed to a **git remote** the instance can clone (GitHub, etc.).
  This repo already has a remote; make sure `main`/`vinayak` is pushed.
- An **SSH client** — Windows 11 has `ssh` built in (PowerShell/Terminal).

---

## 1. Launch the EC2 instance (AWS Console)

1. Sign in → **EC2** → region **Asia Pacific (Mumbai) `ap-south-1`** (matches
   `S3_REGION` defaults and is closest for India traffic).
2. **Launch instance**.
3. **Name:** `ileads-qms`.
4. **AMI:** *Ubuntu Server 24.04 LTS* (64-bit x86).
5. **Instance type:** `t3.small` minimum (2 GB RAM). `t3.medium` (4 GB)
   recommended for comfortable builds. `t3.micro` works only because the
   bootstrap adds 4 GB swap, but the build is slow.
6. **Key pair:** *Create new key pair* → name it `ileads-qms-key`, type **RSA**,
   format **.pem** → download. Save it somewhere safe, e.g.
   `C:\Users\vinay\.ssh\ileads-qms-key.pem`. **You can't re-download it.**
7. **Network settings → Edit → Security group** (create new), allow:
   | Type        | Port | Source              | Why |
   |-------------|------|---------------------|-----|
   | SSH         | 22   | **My IP**           | your admin access |
   | HTTP        | 80   | Anywhere `0.0.0.0/0`| public app traffic |
   | HTTPS       | 443  | Anywhere `0.0.0.0/0`| only if you add TLS later |
   Restricting SSH to *My IP* is strongly recommended over Anywhere.
8. **Configure storage:** bump the root volume to **20 GiB** gp3
   (node_modules + `.next` + Postgres + swap need room; 8 GB default is tight).
9. **Launch instance.** Wait for *Instance state = running* and a
   **Public IPv4 address** to appear — note it, e.g. `13.234.x.x`.

> Tip: a public IP changes on stop/start. If you want a stable address,
> allocate an **Elastic IP** (EC2 → Elastic IPs → Allocate → Associate to the
> instance). Free while associated to a running instance.

---

## 2. Lock down the key file & connect (Windows PowerShell)

```powershell
# Restrict the .pem so ssh accepts it (Windows equivalent of chmod 600)
icacls "C:\Users\vinay\.ssh\ileads-qms-key.pem" /inheritance:r
icacls "C:\Users\vinay\.ssh\ileads-qms-key.pem" /grant:r "$($env:USERNAME):(R)"

# Connect (user is "ubuntu" for the Ubuntu AMI)
ssh -i "C:\Users\vinay\.ssh\ileads-qms-key.pem" ubuntu@<your-ec2-ip>
```

Accept the host fingerprint on first connect. You're now on the box.

---

## 3. Get the code onto the instance (git clone)

```bash
# On the EC2 box. /opt/qms is the conventional location.
sudo apt-get update -y && sudo apt-get install -y git
sudo mkdir -p /opt/qms && sudo chown ubuntu:ubuntu /opt/qms
git clone <your-repo-url> /opt/qms
cd /opt/qms
git checkout main        # or the branch you deploy
```

If the repo is private, use a deploy key or a GitHub Personal Access Token in
the clone URL (`https://<token>@github.com/...`).

---

## 4. Create `.env` (secrets live ONLY on the box)

`.env` is gitignored, so it is **not** in the clone — you create it here.

```bash
cd /opt/qms
cp .env.example .env
nano .env        # or: vi .env
```

Fill these in for a fresh IP-based, single-box deploy:

```dotenv
# Local Postgres on this box. Pick a strong password — the bootstrap creates
# the role/db with exactly this password.
DATABASE_URL="postgresql://ileads_qms_user:CHOOSE_A_STRONG_PASSWORD@localhost:5432/ileads_qms?schema=public"

# Leave APP_SECRET as the placeholder — bootstrap generates a real one.
APP_SECRET="REPLACE_WITH_RANDOM_64_BYTE_VALUE"
APP_PASSWORD="set-a-real-login-password"

# Served at the instance root over plain HTTP → base path empty.
NEXT_PUBLIC_BASE_PATH=""
APP_BASE_URL="http://<your-ec2-ip>"
NODE_ENV="production"

# Live STT + audit (use FRESHLY ROTATED keys — see step 7).
MOCK_STT=false
STT_PROVIDER=sarvam
SARVAM_API_KEY="<rotated sarvam key, account must have credits>"
AUDIT_PROVIDER=openrouter
OPENROUTER_API_KEY="<rotated openrouter key>"
OPENROUTER_AUDIT_MODEL="google/gemini-2.5-flash"

# Audio on local disk (simplest). Switch to s3 later if needed.
AUDIO_STORAGE_PROVIDER="local"
AUDIO_STORAGE_PATH="./storage/audio"
MAX_AUDIO_UPLOAD_MB="100"

SHOW_MOCK_ACTIONS=false
```

`chmod 600 .env` is done for you by the bootstrap; do it now too if you like.

---

## 5. Run the one-shot bootstrap

```bash
cd /opt/qms
sudo bash deploy/bootstrap-ec2.sh
```

This installs Node 22, PM2, PostgreSQL, nginx, adds 4 GB swap if needed,
provisions the DB role/database from `DATABASE_URL`, runs migrations + seed,
builds Next.js, starts the web + worker under PM2 (with a systemd unit so they
survive reboots), and installs the nginx vhost. It is idempotent — safe to
re-run.

> If this is the very first run and `.env` was missing, the script copies
> `.env.example` and **stops** so you can fill it in. Edit `.env` and re-run.

When it finishes it prints verification requests. Expected:
`127.0.0.1:3010/` → `307`, `127.0.0.1:3010/login` → `200`.

---

## 6. Verify

From the box:

```bash
curl -s localhost:3010/api/health        # {"status":"ok","db":"ok",...}
pm2 status                                # ileads-web + ileads-queue-worker online
pm2 logs ileads-web --lines 50
```

From your laptop browser: `http://<your-ec2-ip>/login` → log in with
`APP_PASSWORD`. Upload a call, confirm transcription + audit run (watch
`pm2 logs ileads-queue-worker`).

---

## 7. Security hardening (do this — the repo's keys were exposed)

- [ ] **Rotate every API key** before going live — the Sarvam / OpenRouter /
      Deepgram / Gemini keys currently in the local dev `.env` were exposed and
      must be regenerated at each provider, then put **only** in the EC2 `.env`.
- [ ] **Top up Sarvam credits** — STT returns `402 No credits` on an empty
      account.
- [ ] SSH security group restricted to **My IP**, not `0.0.0.0/0`.
- [ ] `APP_SECRET` is the auto-generated 64-byte value (not the placeholder).
- [ ] `APP_PASSWORD` is strong and not the dev `password`.
- [ ] Consider TLS: easiest is to put the box behind Cloudflare (orange-cloud
      the A record → instance IP) or run certbot for Let's Encrypt and add a
      443 server block. Then set `APP_BASE_URL=https://...`.

---

## 8. Redeploying after code changes

```bash
cd /opt/qms
git pull
bash deploy/redeploy.sh            # install + migrate + build + pm2 reload (NO sudo)
bash deploy/redeploy.sh --seed     # also re-seed (idempotent)
bash deploy/redeploy.sh --no-build # env-only change
```

Run `redeploy.sh` **without sudo** — the bootstrap chowned the repo to
`ubuntu`, and the script refuses sudo on a user-owned tree to avoid
re-breaking ownership.

---

## 9. Common issues

| Symptom | Fix |
|---|---|
| `npm run build` says `Killed` | OOM. Re-run `sudo bash deploy/bootstrap-ec2.sh` (adds swap + raises heap). |
| Browser can't reach the site | Security group missing port 80, or app on `127.0.0.1` only — nginx fronts it; check `sudo systemctl status nginx`. |
| `502 Bad Gateway` | App not up: `pm2 status`, `pm2 logs ileads-web`. |
| `413 Too Large` on upload | nginx `client_max_body_size` — shipped vhost sets `200M`; raise + `sudo nginx -t && sudo systemctl reload nginx`. |
| DB connection fails (`P1000`) | `DATABASE_URL` password ≠ role password. Re-run bootstrap; it resets the role password from `.env`. |
| Login redirects loop | `APP_BASE_URL` / `NEXT_PUBLIC_BASE_PATH` mismatch. For root IP deploy, base path must be `""` and you must rebuild. |

Full diagnostics snapshot: `bash deploy/diagnose.sh > /tmp/qms-diag.txt`.

---

## Where things run

| Component | How | Port |
|---|---|---|
| Web (Next.js) | PM2 `ileads-web` | `127.0.0.1:3010` |
| Background worker | PM2 `ileads-queue-worker` | — |
| Reverse proxy | nginx | `:80` (public) → `127.0.0.1:3010` |
| Database | PostgreSQL | `127.0.0.1:5432` |
| Audio | local disk `storage/audio/` (or S3 if configured) | — |
