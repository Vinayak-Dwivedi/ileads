# QMS Demo Runbook

End-to-end script for running the iLeads QMS demo on the existing server.

- Public app: **http://187.127.139.47/ileads-qms**
- Process manager: **pm2 app `ileads-qms`** (Next.js on `127.0.0.1:3010`, behind nginx)
- DB: PostgreSQL on `localhost:5433`
- STT: **Sarvam Saaras v3** for demo transcription, with local fallback
  **IndicConformer → faster-whisper-small** when enabled.
- AI audit: **OpenRouter Gemma** (`google/gemma-4-31b-it:free`, fallback `google/gemma-4-26b-a4b-it:free`)
- Audio is **never** sent to OpenRouter. Only transcript text + metadata + parameters.

## 0. Pre-flight

```bash
pm2 status ileads-qms
curl -I http://187.127.139.47/ileads-qms/login   # expect HTTP 200
```

If `pm2 status` shows the app not online, see **Section 9 (Logs / Restart)**.

## 1. Login

1. Open **http://187.127.139.47/ileads-qms** in any modern browser.
2. You will be redirected to `/ileads-qms/login`.
3. Enter the demo password (set as `APP_PASSWORD` in `.env`).
4. You land on the Dashboard.

## 2. Upload a call

1. Go to **Calls** in the sidebar.
2. Click **Upload Calls** in the top-right.
3. Pick:
   - Campaign, team, agent (optional)
   - One or more audio files (`.wav`, `.mp3`, `.m4a`, etc.)
4. Submit.
5. The call appears in the Calls table with **Status: PENDING** (no AI score yet).

Expected upload time: a few seconds for files up to a couple of minutes long.

## 3. Run Live Transcription

1. Click the call ID in the Calls table to open Call Detail.
2. In the right-hand rail, find **Transcription**.
3. Click **Run Live Transcription**.
4. Button changes to **Transcribing…** and a blue info box appears:
   *"Transcribing… this may take a few minutes for longer calls."*

Expected behaviour:
- With `STT_PROVIDER=sarvam`, Sarvam Saaras v3 runs first.
- If Sarvam fails and `LOCAL_STT_ENABLED=true`, the pipeline falls back to the
  local chain (`indicconformer` then `faster-whisper-small`).
- Sarvam Batch STT is enabled for demo diarization when `SARVAM_USE_BATCH=true`.
  It returns timestamped diarized segments, which are mapped to Agent/Customer
  by the speaker-mapping env settings.

Required Sarvam env:

```text
STT_PROVIDER=sarvam
SARVAM_API_KEY="<your key>"
SARVAM_STT_MODEL="saaras:v3"
SARVAM_STT_MODE="transcribe"
SARVAM_USE_BATCH=true
SARVAM_BATCH_POLL_INTERVAL_SECONDS=10
SARVAM_BATCH_TIMEOUT_SECONDS=900
SARVAM_MAP_SPEAKERS_TO_AGENT_CUSTOMER=true
SARVAM_SPEAKER_MAPPING_MODE=heuristic
SARVAM_FIRST_SPEAKER=agent
SARVAM_SECOND_SPEAKER=customer
LOCAL_STT_ENABLED=true
```

Never commit API keys.

Speaker mapping modes:
- `heuristic` scores diarized speaker text for agent/customer cues and falls
  back to the configured first/second speaker order if confidence is low.
- `fixed` always maps first observed speaker to `SARVAM_FIRST_SPEAKER` and
  second observed speaker to `SARVAM_SECOND_SPEAKER`.
- `raw` preserves Sarvam speaker ids for investigation.

Calibration command:

```bash
npm run calibrate:speakers
```

This creates short runtime clips from up to five uploaded recordings, runs
Sarvam Batch STT with diarization, and prints raw speaker id, mapped role,
timestamp, and text. It does not write to the database.

Outcome:
- Transcript with speaker-labelled segments shows in the middle column.
- Event timeline gains a `TRANSCRIPT_READY` row.
- Call still shows **Status: PENDING** until an audit runs.

If an individual transcript line has the wrong speaker, use the speaker
dropdown beside that segment. The transcript text, timestamps, confidence, and
raw Sarvam speaker id are unchanged. Corrections are stored for future
training/model improvement. If an audit already exists, click **Re-run AI Audit
after speaker correction** so scoring uses the corrected labels.

If transcription fails twice (primary + fallback), you will see a clear red error
("Transcription failed on both primary and fallback models. Please retry; if it
keeps failing, contact the admin."). See **Section 9** for logs.

Expected Sarvam Batch STT wait time is usually tens of seconds for short demo
clips and up to `SARVAM_BATCH_TIMEOUT_SECONDS=900` seconds before timeout.

## 4. Run AI Audit

1. In the right-hand rail, find **AI Audit Pipeline**.
2. Click **Run AI Audit** (or **Re-run AI Audit** if an audit already exists).
3. Button changes to **Running AI audit…** and a blue info box appears:
   *"Running AI audit… this may take up to 2 minutes. Please keep this page open."*

Expected duration:
- ~50–120 s end-to-end (Gemma free tier is rate-limited and somewhat slow).
- The client retries 429 / 5xx with growing backoff (3 s, 8 s, 18 s, 30 s).
- If the primary `google/gemma-4-31b-it:free` is upstream-rate-limited,
  OpenRouter auto-routes to `google/gemma-4-26b-a4b-it:free` and the success
  card explicitly says *"primary was rate-limited; audit completed using
  fallback model"*.

Outcome:
- Green success card with score, parameter count, event count, sentiment,
  compliance severity, and the actual model used.
- Calls table refreshes: AI Score, Final Score, Sentiment, and Audit Status
  all update to the new audit.
- Dashboard KPIs (Audited count, Average quality, Sentiment breakdown) update.
- Call detail page repaints with parameter-by-parameter scores, events, AI
  insights, and AI summary.

## 5. Process Demo Call (one click)

Optional convenience for an unprocessed call:

1. In the right-hand rail, top card is **Process Demo Call**.
2. Click **Process Demo Call**.
3. The action runs transcription (if missing), then the AI audit.
4. Two step lines show progress: `1. Transcription` and `2. AI Audit`.

If transcription fails, the audit is skipped and the transcript stage shows
red. Re-clicking re-runs both stages.

## 6. Expected wait times

| Step                            | Typical                  | Hard upper bound                          |
| ------------------------------- | ------------------------ | ----------------------------------------- |
| Upload (< 25 MB audio)          | < 5 s                    | 250 MB cap from `MAX_AUDIO_UPLOAD_MB`     |
| Transcription (1–2 min call)    | 30–90 s                  | 7 min (`STT_TIMEOUT_SECONDS=420`)         |
| AI audit                        | 50–60 s                  | 3 min (`OPENROUTER_TIMEOUT_SECONDS=180`) per attempt |
| AI audit with retries on 429    | 50–120 s                 | About 3 min including all backoffs        |

Nginx is configured with `proxy_read_timeout 300s` on `/ileads-qms`, so a
single server-action call can sit on the connection for up to 5 minutes
without nginx severing it.

## 7. OpenRouter rate-limit behaviour

Free Gemma models share a per-account quota at Google AI Studio:
- ~2 requests/minute per model.
- ~100 requests/day (subject to change).

What you will see in the demo:

- **First-time 429 within 5–60 s**: the client backs off and retries; the
  call usually succeeds on attempt 2 or 3. Total elapsed time grows to
  ~70–120 s.
- **All attempts fail with 429**: the UI shows
  *"OpenRouter rate limit reached. Please wait a minute and try again."*
  Wait ~1 minute and click **Re-run AI Audit**.
- **Fallback model used**: the success card shows *"primary `…` was
  rate-limited; audit completed using fallback model"*.
- **API key invalid**: *"OpenRouter rejected the API key. Check
  OPENROUTER_API_KEY in .env."*
- **No key configured**: the **Run AI Audit** button is disabled and the
  panel shows *"OpenRouter API key missing. Add it in .env and restart PM2."*

If you want to escape the free-tier quota, add a personal Google AI Studio
key on **https://openrouter.ai/settings/integrations**. No code change
needed; the demo key stays in `.env` and OpenRouter applies the BYOK
quota.

## 8. What to do if STT is slow

- A long call (5–10 minutes) on CPU can take 3–6 minutes to transcribe.
  This is expected — wait it out. The blue progress box stays visible.
- If you must abort, browser back/refresh is safe. The Python STT child
  process continues server-side until it exits (or hits the 7-minute
  timeout), but the UI does not require the original tab.
- If the same call keeps failing, the logs (Section 9) will tell you
  which model attempted and why; often it's a missing model file or an
  audio format the converter can't handle.

## 9. Logs / restart

```bash
# Tail pm2 logs (live)
pm2 logs ileads-qms

# Last N lines, non-blocking
pm2 logs ileads-qms --lines 120 --nostream

# Restart after .env changes
pm2 restart ileads-qms --update-env

# Process status
pm2 status ileads-qms

# Public URLs
curl -I http://187.127.139.47/ileads-qms
curl -I http://187.127.139.47/ileads-qms/login
curl -I http://187.127.139.47/ileads-qms/calls
```

After a code change, rebuild before restarting:

```bash
cd /root/qms_demo
npm install                              # only if package.json changed
npx prisma generate                      # always safe
npx prisma migrate deploy                # only if migrations exist
NEXT_PUBLIC_BASE_PATH=/ileads-qms npm run build
pm2 restart ileads-qms --update-env
```

## 10. Safety / things not to do

- **Never** commit `.env` — it contains `OPENROUTER_API_KEY`.
- **Never** print the API key in logs or screenshots.
- **Never** send the raw audio file to OpenRouter. The audit prompt
  is built from transcript text only (`buildLiveAuditPrompt.ts`); the
  `openrouterChat` request body never includes audio.
- The mock audit button is hidden in production (`SHOW_MOCK_ACTIONS=false`,
  `NODE_ENV=production`). Do **not** flip those flags during a demo.
- The mock transcription button is similarly hidden.

## 11. Smoke tests (CLI)

Useful for a fast off-browser sanity check.

```bash
# STT only
npm run smoke:stt -- --call <callId>
MOCK_STT=false npm run smoke:stt -- --provider sarvam --file /abs/path/audio.wav
MOCK_STT=false npm run smoke:stt -- --chain --file /abs/path/audio.wav

# Live AI audit only (auto-picks latest call with transcript if no --call)
npm run smoke:audit -- --call <callId>
```

Neither command prints the API key. Both return non-zero on failure.
