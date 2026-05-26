# AWS Production Deployment — iLeads QMS

This builds on the existing Docker image (`Dockerfile`) and PM2 manifest
(`ecosystem.config.js`), which already run **both** the web app
(`ileads-web`) and the background worker (`ileads-queue-worker`) in one
container and run DB migrations on startup (`deploy/docker-entrypoint.sh`).

STT now runs through the native `sarvamai` Node SDK — **no Python, no model
weights, no ffmpeg required** in the image. The container is pure Node.

---

## Target architecture (scalable)

```
                         ┌────────────────────────────┐
   Internet ── HTTPS ──► │ ALB (or CloudFront → ALB)   │
                         └─────────────┬──────────────┘
                                       │ :3010
                   ┌───────────────────┴───────────────────┐
                   │  ECS Fargate service: WEB (next start) │  ← scale 2..N
                   │  same image, command = web only        │
                   └───────────────────┬───────────────────┘
                                       │
   ┌──────────────┐   ┌────────────────┴───────────────┐   ┌──────────────┐
   │  RDS Postgres│◄──│  ECS Fargate service: WORKER   │──►│   S3 bucket  │
   │  (Multi-AZ)  │   │  same image, command = worker  │   │ (recordings) │
   └──────────────┘   │  scale 1..N (safe: see below)  │   └──────────────┘
                      └────────────────────────────────┘
                         calls Sarvam STT + OpenRouter audit (HTTPS out via NAT)
```

Why split web and worker: the web tier scales with HTTP traffic; the worker
tier scales with audio-processing backlog. Running multiple workers is safe —
`scripts/queue-worker.ts` claims calls with a guarded `updateMany`
(`processingStatus: "uploaded"` → `"transcribing"`), so two workers never grab
the same call. Tune throughput with `QUEUE_CONCURRENCY` (parallel calls per
worker) and the worker count.

**Simpler alternative (one box):** run the existing `docker-compose.yml` on a
single EC2 instance, but point `DATABASE_URL` at RDS and set
`AUDIO_STORAGE_PROVIDER=s3`. Good enough to start; you lose independent
scaling and the bundled Postgres container is not durable for production.

---

## Managed services to create

| Service | Purpose | Notes |
|---|---|---|
| **ECR** | Store the Docker image | `docker build` → push |
| **RDS PostgreSQL 16** | Primary DB | Multi-AZ, automated backups. Put it in private subnets. |
| **S3 bucket** | Call recordings | **Private**. Playback uses presigned URLs. Region e.g. `ap-south-1`. |
| **ECS Fargate** (or EC2) | Run web + worker tasks | Two services off the same image. |
| **ALB** | TLS termination + routing to web | ACM cert; health check `GET /` (or `/login`). |
| **Secrets Manager / SSM** | Hold APP_SECRET, DB password, API keys | Inject as task env — do not bake into the image. |
| **CloudWatch Logs** | Container logs | `awslogs` driver. |
| (optional) **ElastiCache Redis** | BullMQ queue | Only if you set `REDIS_URL` and switch to `worker:bullmq`. The Postgres-polling worker needs no Redis. |

IAM: give the **worker** task role `s3:PutObject`, `s3:GetObject`,
`s3:DeleteObject` on `arn:aws:s3:::YOUR_BUCKET/*`; the **web** task role needs
`s3:GetObject` (+ `PutObject` for direct uploads). Prefer task roles over
static `S3_ACCESS_KEY_ID/SECRET` — when running on ECS with a task role you can
leave those two env vars empty and the AWS SDK picks up the role automatically.

---

## Required environment (per task / `.env`)

```dotenv
NODE_ENV=production
APP_SECRET=<64-byte random>                 # node -e "console.log(require('crypto').randomBytes(64).toString('base64url'))"
DATABASE_URL=postgresql://USER:PASS@<rds-endpoint>:5432/ileads_qms?schema=public
APP_BASE_URL=https://qms.yourdomain.com

# Storage → S3
AUDIO_STORAGE_PROVIDER=s3
S3_BUCKET=your-bucket
S3_REGION=ap-south-1
# Leave the next two EMPTY when using an ECS task role (recommended):
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=

# STT → Sarvam (Node SDK, no Python). ACCOUNT MUST HAVE CREDITS.
STT_PROVIDER=sarvam
SARVAM_API_KEY=<rotated key>
SARVAM_STT_MODEL=saaras:v3
SARVAM_STT_MODE=transcribe
# SARVAM_LANGUAGE_CODE=hi-IN        # optional; omit for auto-detect

# Audit → OpenRouter
AUDIT_PROVIDER=openrouter
OPENROUTER_API_KEY=<rotated key>
OPENROUTER_AUDIT_MODEL=google/gemini-2.5-flash

QUEUE_CONCURRENCY=3
```

---

## Build & push the image

```bash
aws ecr get-login-password --region ap-south-1 \
  | docker login --username AWS --password-stdin <acct>.dkr.ecr.ap-south-1.amazonaws.com

docker build -t ileads-qms --build-arg NEXT_PUBLIC_BASE_PATH="" .
docker tag ileads-qms:latest <acct>.dkr.ecr.ap-south-1.amazonaws.com/ileads-qms:latest
docker push <acct>.dkr.ecr.ap-south-1.amazonaws.com/ileads-qms:latest
```

(`NEXT_PUBLIC_BASE_PATH` is baked at build time. Leave empty when serving at
the domain root; set e.g. `/ileads-qms` only if you serve under a sub-path.)

## Run web and worker as separate ECS services (same image)

The image entrypoint runs migrations then `pm2-runtime start
ecosystem.config.js` (web + worker together). For the split-service model,
**override the container command** so each service runs one role:

- **WEB service** — let migrations run, start only the web app:
  ```
  command: ["sh","-c","npx prisma migrate deploy && pm2-runtime start node_modules/next/dist/bin/next --name ileads-web -- start -H 0.0.0.0 -p 3010"]
  ```
  Set `RUN_DB_MIGRATE=false` on the worker so only one service migrates.

- **WORKER service** — skip migrations, run only the worker:
  ```
  RUN_DB_MIGRATE=false
  command: ["pm2-runtime","start","node_modules/tsx/dist/cli.mjs","--name","ileads-queue-worker","--","--require","./scripts/_stt-preload.cjs","scripts/queue-worker.ts"]
  ```

If you prefer the simplest path, run **one** ECS service with the default
entrypoint (PM2 runs both roles in the task) and scale to a single task —
correct, just not independently scalable.

---

## Post-deploy verification

1. ALB health check green; `https://qms.yourdomain.com` loads and you can log in.
2. Upload one call (single) and a small Excel sheet.
3. Confirm objects land in S3 under `s3://YOUR_BUCKET/YYYY-MM-DD/...`.
4. Worker logs (CloudWatch) show `Processing call → Transcription done → Audit done`.
5. Open the call: transcript + AI score + audio playback all work.

---

## Production hardening checklist

- [ ] **Rotate all API keys** (Sarvam, OpenRouter, Deepgram, Gemini) — the ones
      currently in `.env` were committed/exposed previously. Store new ones in
      Secrets Manager, not the image.
- [ ] **Top up Sarvam credits** — a smoke test returned `402 No credits
      available`. STT will fail until the account has balance.
- [ ] RDS in private subnets, security group allows only the ECS tasks.
- [ ] S3 bucket: Block Public Access ON, default encryption (SSE-S3/KMS),
      lifecycle rule to expire/transition old recordings if desired.
- [ ] `APP_SECRET` is a unique 64-byte value (not the dev placeholder).
- [ ] Set `SENTRY_DSN` for error tracking (optional but recommended).
- [ ] HTTPS only at the ALB; HTTP→HTTPS redirect.
- [ ] Autoscaling: web on CPU/req count; worker on a backlog metric or fixed
      2–3 tasks with `QUEUE_CONCURRENCY=3`.
```
