# QMS - Quality Management System

A standalone Quality Management System for contact-centre call audits. This
repo contains the database schema, password auth, base-path routing, layouts,
seed data, DB-backed screens, and the current mock audit pipeline.

The app deploys directly on the host with Node.js, PostgreSQL, PM2, and Nginx.
It is served publicly at:

```text
http://187.127.139.47/ileads-qms
```

## Tech Stack

- Next.js 16 App Router
- TypeScript
- Tailwind CSS and shadcn-style primitives
- PostgreSQL via Prisma ORM
- Password-based session auth
- PM2-managed production process
- Nginx reverse proxy

## Modules

| Module | Path | What's there |
| --- | --- | --- |
| Dashboard | `/dashboard` | KPI cards, sentiment distribution, agent scoreboard, and AI insights filtered by client/campaign/team/agent/date range |
| Call Library | `/calls` | Searchable and filterable call table with multi-file audio upload |
| Call Detail | `/calls/[id]` | Audio player, transcript, audit scores, insights, timeline, manual review form, and notes |
| Parameter Builder | `/parameters` | Client-owned binary-scored parameter CRUD |
| Clients | `/clients` | Tenant directory and status controls |
| Settings | `/settings` | Environment, DB, AI status, base URL, and base path display |

## Database

The schema is in `prisma/schema.prisma` and uses PostgreSQL through
`DATABASE_URL`.

Default direct deployment values:

```text
database: ileads_qms
user:     ileads_qms_user
host:     localhost:5432
```

Create `.env` from the example and replace `CHANGE_ME` before provisioning:

```bash
cp .env.example .env
$EDITOR .env
```

For a fresh EC2 / Ubuntu host, the one-shot bootstrap script provisions
PostgreSQL, applies the schema, and seeds demo data in a single command —
see `docs/deployment-runbook.md`. To do the same steps by hand:

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
# create the role + db (or just run deploy/bootstrap-ec2.sh which does this for you)
sudo -u postgres psql -c "CREATE ROLE ileads_qms_user LOGIN PASSWORD '<pwd>';"
sudo -u postgres psql -c "CREATE DATABASE ileads_qms OWNER ileads_qms_user;"
npx prisma migrate deploy
npm run db:seed
```

The demo client is **Beetel**. Its active evaluation sheet has **24 parameters**
across Opening / Call Handling & Soft skills / Product & Process handling /
Closing categories, totalling **100** points. Parameters that already have
audit history should be deactivated, not deleted; the UI enforces this.

To re-import or refresh the Beetel parameter set against an existing client
record (idempotent), run:

```bash
npm run import:beetel-parameters
```

## Local Development

For local root-path development, set `NEXT_PUBLIC_BASE_PATH=""` in `.env`.
Then run:

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run db:seed
npm run dev
```

Production is built under `/ileads-qms`, so the production build command must
include the base path:

```bash
NEXT_PUBLIC_BASE_PATH=/ileads-qms npm run build
```

## Direct Deployment

Expected production `.env` values:

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
AUDIO_STORAGE_PROVIDER="local"
AUDIO_STORAGE_PATH="./storage/audio"
MAX_AUDIO_UPLOAD_MB="100"
```

First-time deploy (fresh EC2 instance, runs everything top to bottom):

```bash
cd /opt/qms
sudo bash deploy/bootstrap-ec2.sh
```

Re-deploy after a `git pull`:

```bash
bash deploy/redeploy.sh             # install + migrate + build + pm2 reload
bash deploy/redeploy.sh --seed      # also re-seed (idempotent)
bash deploy/redeploy.sh --no-build  # env-only change
```

Full deployment guide: `docs/deployment-runbook.md`.

Useful PM2 commands:

```bash
pm2 status
pm2 logs ileads-qms --lines 100
pm2 restart ileads-qms
pm2 save
pm2 startup
```

## Base Path

`next.config.ts` reads `NEXT_PUBLIC_BASE_PATH` at build time and passes it to
Next.js `basePath`. For production, build with:

```bash
NEXT_PUBLIC_BASE_PATH=/ileads-qms npm run build
```

Routing invariants:

- `/ileads-qms` reaches the app.
- `/ileads-qms/login` reaches the login page.
- `/ileads-qms/dashboard` redirects to login when unauthenticated.
- `/ileads-qms/_next/*` assets are proxied to the same Node process.
- Hand-built redirects use `src/lib/base-path.ts` to avoid double prefixes.

## Audio Uploads

The Calls screen supports demo audio ingestion through the `Upload Calls`
button. The upload dialog accepts multiple files in these formats:

```text
.mp3 .wav .m4a .ogg .webm .aac .flac
```

Uploaded files are stored locally when:

```text
AUDIO_STORAGE_PROVIDER=local
AUDIO_STORAGE_PATH=./storage/audio
MAX_AUDIO_UPLOAD_MB=100
```

`AUDIO_STORAGE_PATH` is resolved from the project root when relative. The
files are not placed in `public/`; call detail streams them through the
authenticated route:

```text
/api/calls/[callId]/audio
```

Each uploaded file creates one `Call` row with the selected client metadata,
optional campaign/team/agent/customer details, audio metadata, and a
`CALL_IMPORTED` event. Uploaded calls stay pending and have no transcript,
AI score, manual score, or final score until transcription/audit flows are
run. Raw audio is used only by the STT provider; OpenRouter receives transcript
text only.

Existing local files in `AUDIO_STORAGE_PATH` can be imported into the Calls
table without copying or modifying the audio files:

```bash
npm run import:audio
```

The import scans supported audio files, skips files already linked to a call,
uses the first active client by default, and creates `CALL-IMPORT-*` records.
Set `IMPORT_AUDIO_CLIENT_ID` or `IMPORT_AUDIO_CLIENT_SLUG` to target a specific
client.

Call detail uses Sarvam Batch STT for demo transcription and OpenRouter/Gemma
for live text-only audit. Mock actions remain available only when explicitly
enabled for development; they are hidden in the production demo.

## STT Providers

For the demo, live transcription is provider-driven:

```text
STT_PROVIDER=sarvam
SARVAM_API_KEY=""
SARVAM_STT_MODEL="saaras:v3"
SARVAM_STT_MODE="transcribe"
SARVAM_TIMEOUT_SECONDS="300"
SARVAM_ENABLE_DIARIZATION=true
SARVAM_USE_BATCH=true
SARVAM_BATCH_POLL_INTERVAL_SECONDS=10
SARVAM_BATCH_TIMEOUT_SECONDS=900
SARVAM_MAP_SPEAKERS_TO_AGENT_CUSTOMER=true
SARVAM_SPEAKER_MAPPING_MODE=heuristic
SARVAM_FIRST_SPEAKER=agent
SARVAM_SECOND_SPEAKER=customer
LOCAL_STT_ENABLED=true
```

With `STT_PROVIDER=sarvam`, the app uses Sarvam Saaras v3 first. If Sarvam
fails and `LOCAL_STT_ENABLED=true`, it falls back to the local chain. Do not
commit API keys.

The simple Sarvam STT endpoint can return a transcript without usable
timestamps or speaker labels. For call audit demos, use `SARVAM_USE_BATCH=true`
so the app requests Batch STT with timestamps and diarization. Speaker IDs are
mapped by default using `SARVAM_SPEAKER_MAPPING_MODE=heuristic`, which scores
speaker text for agent/customer cues and falls back to the configured first/second
speaker order if confidence is low. Use `fixed` to force first observed speaker
-> Agent and second -> Customer, or `raw` to keep raw speaker IDs for
investigation. If a specific line has the wrong speaker, correct it with the
speaker dropdown beside that transcript segment, then re-run the AI audit.
Corrections are stored for future training/model improvement. You can also run
calibration against short real-call clips:

Smoke tests:

```bash
MOCK_STT=false npm run smoke:stt -- --provider sarvam --file /abs/path/audio.wav
MOCK_STT=false npm run smoke:stt -- --chain --file /abs/path/audio.wav
npm run calibrate:speakers
```

## Local STT (fallback/R&D chain)

The Node app calls a Python subprocess (`stt/transcribe.py`) that loads a model
by `--model-key` and writes JSON. The Node side runs models in chain order
(primary → fallback) until one succeeds.

```text
stt/
  requirements.txt
  transcribe.py                 <- unified entrypoint (used by Node)
  transcribe_indicwhisper.py    <- legacy single-model script (kept for parity)
  transcribe_indicconformer.py  <- legacy single-model script
  README.md
scripts/
  setup-stt-env.sh
  smoke-test-stt.ts
  stt/
    download-models.sh          <- downloads enabled model weights
    download_models.py
models/
  indicconformer-600m/          <- AI4Bharat IndicConformer 600M (gated)
  faster-whisper-small/         <- Systran/faster-whisper-small (CT2)
runtime/stt/                    <- per-run JSON output (gitignored)
.venv-stt/                      <- Python venv (gitignored)
```

### Models

| Role | Key | HF repo | Notes |
| --- | --- | --- | --- |
| Primary | `indicconformer` | `ai4bharat/indic-conformer-600m-multilingual` | **Gated** — needs `HF_TOKEN` |
| Fallback 1 | `faster-whisper-small` | `Systran/faster-whisper-small` | CPU-friendly fallback |

All paths, repos, devices, languages, thresholds, and chain order are env-driven
(see `.env.example`). The Node business logic never references a model name
directly; everything flows through `loadSttConfig()` and `resolveModelChain()`.

### Setup

```bash
# 1. Create Python venv + install deps (torch CPU wheel by default)
bash scripts/setup-stt-env.sh

# 2. (Gated repo only) export your Hugging Face token before downloading
export HF_TOKEN="hf_..."

# 3. Download model weights (idempotent; failure of one model does not stop the others)
bash scripts/stt/download-models.sh
```

### Switching mock ↔ live STT

```text
MOCK_STT=false         # Run Live Transcription activates the configured provider
STT_PROVIDER=sarvam    # Sarvam first; local fallback when enabled
SHOW_MOCK_ACTIONS=false # hide mock controls outside development
```

```bash
pm2 restart ileads-qms --update-env
```

### Smoke test

```bash
npm run smoke:stt                                  # configured primary (honors MOCK_STT)
npm run smoke:stt -- --provider sarvam             # Sarvam simple STT endpoint
npm run smoke:stt -- --chain                       # configured provider chain (records each attempt)
npm run smoke:stt -- --model indicconformer
npm run smoke:stt -- --model faster-whisper-small
npm run smoke:stt -- --model mock
npm run smoke:stt -- --file /abs/path/audio.wav --chain
```

The smoke test picks the shortest valid audio file under `storage/audio` by
default. It prints every chain attempt with timing + error code so you can
spot which model is failing.

### Fallback behaviour

Today the chain is **full-call failover**: a model either produces a full
transcript or its attempt is recorded as failed and the next model runs. The
UI surfaces every attempt under "STT chain attempts" and tags the saved
transcript with the winning model.

**Weak-segment fallback** (re-transcribing only low-confidence chunks with the
next model) is a follow-up — it requires the Python contract to expose per-chunk
confidence + a chunk-targeted re-run API.

### CPU vs GPU

If `nvidia-smi` is unavailable the venv installs torch CPU wheels and
faster-whisper runs in `int8`. The configured fallback should be
`faster-whisper-small` on this CPU server; switch the fallback env values to
`faster-whisper-base` if small is still too slow.

### Gemma / OpenRouter

Gemma/OpenRouter receives saved transcript text, call metadata, and parameters.
It never receives raw audio. The STT provider is the only component that
touches audio.

## Project Layout

```text
prisma/
  schema.prisma
  seed.ts
src/
  app/
    layout.tsx
    page.tsx
    login/
    api/auth/
    (app)/
      dashboard/
      calls/
      parameters/
      clients/
      settings/
  components/
    ui/
    layout/
  lib/
    auth.ts
    base-path.ts
    db.ts
    session.ts
    data/
  services/
    audit/
  proxy.ts
deploy/
  bootstrap-ec2.sh          # one-shot fresh-EC2 install
  redeploy.sh               # re-deploy after a git pull
  diagnose.sh               # read-only status snapshot
  nginx.conf                # standalone vhost installed by bootstrap
  nginx.snippet.conf        # location-only snippet for existing vhosts
  docker-entrypoint.sh      # used by Dockerfile
docs/
  deployment-runbook.md
```

The `/root/qms_demo/html` reference folder is not used at runtime or build
time.

## Useful Scripts

```bash
npm run dev          # next dev
npm run build        # prisma generate + next build
npm run start        # next start on 127.0.0.1:3010
npm run start:prod   # production start on 127.0.0.1:3010
npm run db:generate  # prisma generate
npm run db:migrate   # prisma migrate dev
npm run db:deploy    # prisma migrate deploy
npm run db:seed      # tsx prisma/seed.ts
npm run db:reset     # prisma migrate reset --force
```

## AI Pipeline Status

Live STT and OpenRouter audit are implemented. For the demo, Sarvam is the
primary STT provider and local STT remains available as fallback/R&D.

For the full production host procedure, see
[`docs/deployment-runbook.md`](docs/deployment-runbook.md).
