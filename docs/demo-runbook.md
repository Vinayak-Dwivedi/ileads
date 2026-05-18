# QMS Demo Runbook

Short operator guide for running the iLeads QMS demo.

- Public app: **http://187.127.139.47/ileads-qms**
- Process manager: **pm2 app `ileads-qms`** (Next.js on `127.0.0.1:3010`, behind nginx)
- DB: PostgreSQL on `localhost:5433`
- STT: **Sarvam Saaras v3** (Batch with diarization), optional local fallback
  **IndicConformer → faster-whisper-small**.
- AI audit: **OpenRouter** Gemma (`google/gemma-4-31b-it:free`, fallback
  `google/gemma-4-26b-a4b-it:free`).
- Audio is **never** sent to OpenRouter — only transcript text, metadata, and parameters.

## 1. Login

1. Open **http://187.127.139.47/ileads-qms** in a modern browser.
2. You are redirected to `/ileads-qms/login`.
3. Enter the demo password (configured as `APP_PASSWORD` in `.env`).
4. You land on the Dashboard.

## 2. Upload a call

1. Click **Calls** in the sidebar.
2. Click **Upload Calls** (top-right).
3. Pick campaign / team / agent (optional) and one or more audio files
   (`.wav`, `.mp3`, `.m4a`, `.ogg`, `.webm`, `.aac`, `.flac`).
4. Submit. The success banner shows how many calls were uploaded.
5. The call appears in the Calls table with **Status: PENDING**.

## 3. Process Demo Call

1. Click the call row to open Call Detail.
2. In the right rail, click **Process Demo Call**.
3. This runs:
   - Step 1/2 — transcription (if missing)
   - Step 2/2 — AI audit

Keep this page open while processing.

## 4. Expected wait times

| Step                           | Typical    | Upper bound                       |
| ------------------------------ | ---------- | --------------------------------- |
| Upload (small audio)           | < 5 s      | `MAX_AUDIO_UPLOAD_MB` cap         |
| Transcription, short call      | 10–60 s    | a few minutes                     |
| Transcription, multi-minute    | 1–5 min    | `SARVAM_BATCH_TIMEOUT_SECONDS=900`|
| AI audit                       | 50–120 s   | `OPENROUTER_TIMEOUT_SECONDS=180`  |

Longer calls genuinely take several minutes. Do not refresh during active
processing unless necessary.

## 5. Speaker correction

1. The transcript shows each segment with a speaker label and a dropdown.
2. Speaker labels are estimated. If a segment has the wrong speaker, pick the
   correct one in the dropdown — only that line changes. Text, timestamps,
   and confidence are preserved.
3. After any correction, click **Re-run AI Audit after speaker correction**
   so scoring uses the corrected labels.

## 6. Parameters

Path: **Parameters → pick a client**.

The demo client is **Beetel**. Its active evaluation sheet has **24 parameters**
across four categories totalling **100** points:

| Category                       | Parameters | Points |
| ------------------------------ | ---------- | ------ |
| Opening                        | 3          | 9      |
| Call Handling/ Soft skills     | 16         | 70     |
| Product/Process handling       | 3          | 15     |
| Closing                        | 2          | 6      |
| **Total**                      | **24**     | **100**|

To (re)import the Beetel set into an existing client record:

```bash
npm run import:beetel-parameters
```

The script is idempotent and preserves audit history for old parameters by
**deactivating** them (never deleting them).

In-app behaviour:

- Add, edit, deactivate, or delete parameters.
- **Delete** removes a parameter — only allowed when the parameter has never
  been used in an audit.
- Parameters with audit history cannot be deleted: the delete icon is
  disabled and a banner reads:
  *"This parameter has audit history and cannot be deleted. Deactivate it instead."*
- **Deactivate** keeps history intact and removes the parameter from future
  audits. Reactivate at any time with the same Power button.
- Edits to category, description, max score, and AI instruction take effect
  on the next audit run.

The default audit prompt is generated from active parameters at audit time.
A custom audit prompt can be saved per client; it is auto-versioned.

## 7. If processing seems stuck

- A long call (5–10 minutes) on CPU can take several minutes to transcribe.
  This is expected — wait. The blue progress box stays visible.
- If the AI audit is rate-limited (OpenRouter free tier), the client retries
  with backoff. Total elapsed grows to ~2 min.
- Only use **Reset processing state** if a previous run clearly failed/hung.
  Locks auto-clear after 30 minutes.

## 8. If OpenRouter rate-limit appears

- The banner reads: *"OpenRouter rate limit reached. Please wait a minute and try again."*
- Wait about 1 minute, then click **Re-run AI Audit**.
- If retried twice and still failing, switch to a personal OpenRouter key
  (BYOK) at <https://openrouter.ai/settings/integrations>; no code change
  required.

## 9. What not to do

- Do not refresh during active processing unless necessary.
- Do not run multiple back-to-back audits on the same call — it just burns
  rate-limit quota.
- Do not commit `.env`.
- Do not print or screenshot the API keys.
- Do not enable the mock buttons during a demo. In production they are
  hidden (`SHOW_MOCK_ACTIONS=false`, `NODE_ENV=production`).

## 10. Logs (for the developer)

```bash
# Tail (live)
pm2 logs ileads-qms

# Last 120 lines, non-blocking
pm2 logs ileads-qms --lines 120 --nostream

# Restart after .env changes
pm2 restart ileads-qms --update-env

# Process status
pm2 status ileads-qms
```

Sanity-check public URLs:

```bash
curl -I http://187.127.139.47/ileads-qms
curl -I http://187.127.139.47/ileads-qms/login
curl -I http://187.127.139.47/ileads-qms/calls
curl -I http://187.127.139.47/ileads-qms/parameters
```

## 11. Rebuild after code changes

```bash
cd /root/qms_demo
npm install                                # only if package.json changed
npx prisma generate
npx prisma migrate deploy                  # only if migrations exist
NEXT_PUBLIC_BASE_PATH=/ileads-qms npm run build
pm2 restart ileads-qms --update-env
```
