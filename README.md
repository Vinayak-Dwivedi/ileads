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

Provision local PostgreSQL on Ubuntu:

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo bash deploy/setup-postgres.sh
```

Then apply the schema and seed demo data:

```bash
npx prisma migrate deploy
npm run db:seed
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
MOCK_STT="true"
MOCK_LLM="true"
AUDIO_STORAGE_PROVIDER="local"
AUDIO_STORAGE_PATH="./storage/audio"
MAX_AUDIO_UPLOAD_MB="100"
```

Deploy or redeploy the app:

```bash
cd /root/qms_demo
bash deploy/deploy-direct.sh
```

Seed during deployment only when needed:

```bash
bash deploy/deploy-direct.sh --seed
```

Install the Nginx route:

```bash
sudo bash deploy/install-nginx-direct.sh
```

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
run. Live STT and live OpenRouter are still intentionally not implemented.

Existing local files in `AUDIO_STORAGE_PATH` can be imported into the Calls
table without copying or modifying the audio files:

```bash
npm run import:audio
```

The import scans supported audio files, skips files already linked to a call,
uses the first active client by default, and creates `CALL-IMPORT-*` records.
Set `IMPORT_AUDIO_CLIENT_ID` or `IMPORT_AUDIO_CLIENT_SLUG` to target a specific
client.

Call detail includes a demo-only `Run Mock Transcription` action. It stores a
Hinglish transcript in `call_transcripts` and `transcript_segments`, then the
existing mock audit can score the saved transcript when active client
parameters exist. Raw audio is for STT only; Gemma/OpenRouter must never receive
raw audio.

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
  setup-postgres.sh
  deploy-direct.sh
  install-nginx-direct.sh
  diagnose-direct.sh
  nginx.conf
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

Live STT and OpenRouter audit calls are not implemented in this step.
Environment placeholders are present for the planned IndicWhisper primary
path, IndicConformer fallback path, OpenRouter models, and local audio
storage. The existing mock audit flow remains the active pipeline.

For the full production host procedure, see
[`docs/deployment-runbook.md`](docs/deployment-runbook.md).
