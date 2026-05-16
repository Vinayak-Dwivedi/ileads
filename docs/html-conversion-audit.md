# UI Conversion Audit — `/html` → Next.js

This document records how the static HTML mocks under `/root/qms_demo/html`
were converted into the production Next.js UI, and confirms the running app
no longer depends on that folder at runtime or build time.

The `/html` folder is reference material only. It can be deleted; the app will
still build and serve correctly.

## 1. Files converted

| Source HTML | Purpose | Now lives in |
| --- | --- | --- |
| `html/qms_dashboard.html` | Dashboard with KPI cards, sentiment, agent scoreboard, AI insights | `src/app/(app)/dashboard/page.tsx` + `src/app/(app)/dashboard/filter-bar.tsx` |
| `html/Calls.html` | Call library: filter bar, results table, action buttons, upload button | `src/app/(app)/calls/page.tsx` + `src/app/(app)/calls/filter-bar.tsx` + `src/app/(app)/calls/upload-calls-dialog.tsx` |
| `html/Calls Detail.html` | Call detail: audio player, info panel, highlight cards, transcript, AI summary, manual review, notes, event timeline | `src/app/(app)/calls/[id]/page.tsx` + `audio-player.tsx`, `manual-review-form.tsx`, `notes-panel.tsx`, `actions.ts` |
| `html/QA.html` | Parameter builder: grouped parameter table, filter bar, modal CRUD | `src/app/(app)/parameters/page.tsx` + `src/app/(app)/parameters/editor.tsx` + `src/app/(app)/parameters/actions.ts` |

Sidebar / topbar style from each mock collapsed into shared layout
components:

- `src/components/layout/sidebar.tsx` (desktop sidebar)
- `src/components/layout/mobile-nav.tsx` (compact mobile bottom bar)
- `src/components/layout/topbar.tsx` (server component reading the session)

The shared shell now uses the reference-style fixed `w-64` light sidebar,
`QMS Audit` grouped navigation, nested Dashboard / Calls / QA links, and the
72px white topbar used by the HTML pages.

Visual primitives that the mocks repeated were extracted to:

- `src/components/ui/pill.tsx` — colored badge pills.
- `src/components/ui/score-pill.tsx` — AI / manual / audit-status pills.
- `src/components/ui/sentiment-badge.tsx` — sentiment icon + label.
- `src/components/ui/page-shell.tsx` — page padding wrapper and `EmptyState`.

Calls ingestion now lives in native Next.js code:

- `src/app/api/calls/upload/route.ts` handles authenticated multipart uploads.
- `src/app/api/calls/[callId]/audio/route.ts` streams stored audio by call ID.
- `src/lib/audio-storage.ts` owns safe local filenames, type validation, and
  the `AUDIO_STORAGE_PATH` / `MAX_AUDIO_UPLOAD_MB` settings.

## 2. Routes that now contain the converted UI

| Route (under `/ileads-qms`) | Source component |
| --- | --- |
| `/dashboard` | `src/app/(app)/dashboard/page.tsx` |
| `/calls` | `src/app/(app)/calls/page.tsx` |
| `/calls/[id]` | `src/app/(app)/calls/[id]/page.tsx` |
| `/parameters` | `src/app/(app)/parameters/page.tsx` |
| `/clients` | `src/app/(app)/clients/page.tsx` |
| `/settings` | `src/app/(app)/settings/page.tsx` |
| `/login` | `src/app/login/page.tsx` |

All static styling has been re-expressed in Tailwind utility classes inside
those components. No CSS is imported from `/html`, and no React component
reads HTML files from disk.

## 3. Confirmation that `/html` is not required

A repository-wide search for references to the folder/files:

```bash
grep -rn -F --include='*.ts' --include='*.tsx' --include='*.js' \
  --include='*.json' --include='*.md' --include='*.yml' --include='*.conf' \
  -e '/html' -e 'qms_dashboard.html' -e 'Calls.html' \
  -e 'Calls Detail.html' -e 'Calls%20Detail' -e 'QA.html' \
  /root/qms_demo --exclude-dir=node_modules --exclude-dir=.next \
  --exclude-dir=graphify-out --exclude-dir=html
```

Runtime/build source does not import, read, link, iframe, or otherwise depend
on the `html/` directory. Documentation may still name the reference files so
future UI work can trace which mock each page came from.

## 4. Visual differences vs. the original mocks

The conversion is faithful to the mocks except where the mock would have
required fabricating data we don't have:

- **Dashboard "Trainings (by Weekly)" SVG bar chart** — replaced with a
  DB-backed score summary and an empty trend state. The schema has no weekly
  buckets, and rendering hardcoded bars would be misleading.
- **Dashboard scoreboard "Trend %" column** — omitted; no historical
  comparison data exists in the schema yet.
- **Dashboard KPI deltas / "vs last month" copy** — omitted. Month-over-month
  comparison data is not stored, so showing deltas would fabricate metrics.
- **Calls listing pagination control** — represented as a single active page
  for the current DB-backed result set. Real pagination can be added behind
  the same filter bar.
- **Calls listing inline `Manual Score` text input and `Manual Disposition`
  select** — replaced with read-only pills. Editing is done via the manual
  review form on the call detail page, which is a single source of truth
  that also writes the audit event and updates `calls.final_score`.
- **Call detail "Insights / Notes (2)" tab badges** — show real counts.
  Empty tabs render a clean empty state.
- **Call detail audio waveform** — rendered as a deterministic SVG bar
  pattern so SSR markup matches CSR. Event markers map to real
  `call_events` rows positioned by their `occurredAt` relative to
  `callStartedAt`.
- **Parameter builder "Sub Parameters"** — the schema is flat
  (`ClientParameter` has `parameterCategory` + `parameterName`). The grouped
  display uses `rowSpan` on the category column to match the visual
  grouping in `QA.html`.
- **Parameter builder "Process / Campaign" filters** — the schema doesn't
  store a `process` field on parameters. Filtering is by `parameterCategory`
  instead. Client filtering remains.
- **Sidebar "QMS Audit" expandable group** — converted into the shared app
  shell. The group is always open, matching the visible reference state.
- **Calls topbar upload button** — converted. It opens a native React dialog
  for multi-file local audio upload. This is local demo ingestion only; it
  does not implement dialer integration, live STT, or live OpenRouter.

## 5. Visual comparison checklist

### Dashboard

| Check | Status | Notes |
| --- | --- | --- |
| Header matched | Yes | Uses the same page title hierarchy inside the converted reference shell. |
| KPI cards matched | Yes | Card shape, spacing, borders, and blue metric emphasis follow `qms_dashboard.html`. |
| Filters matched | Yes | Client, date range, team, agent, campaign, and duration filters are in a single white card. |
| Charts/sections matched | Partial | Sentiment, quality score, scoreboard, and insights sections are present. Static fake weekly chart is replaced with an empty trend state until real buckets exist. |
| Dummy data removed | Yes | All dashboard values come from database queries. |

### Calls

| Check | Status | Notes |
| --- | --- | --- |
| Upload button matched | Yes | The primary `Upload Calls` button sits in the calls topbar beside the export action. |
| Filter section matched | Yes | Search and filter controls are grouped in the same top filter card pattern. |
| Table matched | Yes | DB-backed call rows use the reference table structure, badges, and action affordances. |
| Badges matched | Yes | Sentiment, scores, audit status, and disposition render as colored pills. |
| Upload flow retained | Yes | Multi-file upload, metadata fields, validation, DB records, and refresh behavior remain active. |

### Call Detail

| Check | Status | Notes |
| --- | --- | --- |
| Audio section matched | Yes | Uploaded calls use the secure audio streaming route in the detail audio panel. |
| Timeline matched | Yes | Events render from stored call events; empty data renders a clean state. |
| Transcript matched | Yes | Transcript data is DB-backed, with the required STT-disabled empty state when missing. |
| Parameter scores matched | Yes | Parameter scores are shown from stored audit/manual review data only. |
| Notes/manual review matched | Yes | Existing notes and review controls fit into the converted detail layout. |

### Parameters

| Check | Status | Notes |
| --- | --- | --- |
| QA table matched | Yes | The table uses grouped parameter category rows and QA-style action controls. |
| Add/edit modal matched | Yes | The modal follows the `QA.html` title, spacing, form fields, and save/cancel layout. |
| Category grouping matched visually | Yes | Grouping is visual only through `parameterCategory`; no group table was added. |
| No `parameter_groups` table added | Yes | The schema remains flat and client-specific. |

## 6. Verification commands

To prove the app does not need `/html`:

```bash
# 1. Move the reference folder aside.
mv /root/qms_demo/html /root/qms_demo/html_BACKUP_DO_NOT_USE

# 2. Build (basePath baked in).
NEXT_PUBLIC_BASE_PATH=/ileads-qms npx next build

# 3. Optional: run the standalone server and smoke-test the routes.
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/ 2>/dev/null || true
( cd .next/standalone && \
  APP_SECRET="test-secret-must-be-long-enough-okay" \
  APP_PASSWORD="demo-password" \
  DATABASE_URL="postgresql://qms:qms@localhost:5432/qms?schema=public" \
  PORT=3139 HOSTNAME=127.0.0.1 \
  NEXT_PUBLIC_BASE_PATH=/ileads-qms \
  node server.js ) &
SERVER_PID=$!
sleep 3
for path in login dashboard calls parameters clients settings; do
  curl -s -o /dev/null -w "$path -> %{http_code}\n" \
    http://127.0.0.1:3139/ileads-qms/$path
done
kill $SERVER_PID

# 4. (Optional) restore the reference folder for documentation.
mv /root/qms_demo/html_BACKUP_DO_NOT_USE /root/qms_demo/html
```

Expected output: `next build` succeeds, all six routes return 200 (or 307
for `/dashboard` if the test isn't authenticated — see the smoke test in
the README for an authenticated check).

After this verification the `html/` folder can be deleted permanently.
