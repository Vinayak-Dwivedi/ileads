# AI audit pipeline

Server-only services that drive the call-quality audit. The production
pipeline now runs **live** against OpenRouter (Gemma). A deterministic mock
mode is preserved as a developer-only fallback (gated behind
`SHOW_MOCK_ACTIONS=true` or `NODE_ENV=development`).

```
audio file
   │
   ▼
┌────────────────────────────────────────┐
│ STT (Speech-to-Text)                   │   ◄── IndicConformer 600M
│  - full transcript                     │       (fallback: faster-whisper-small)
│  - timestamped segments                │
│  - speaker labels (when available)     │
│  - per-segment confidence (when avail) │
└────────────────────────────────────────┘
   │
   ▼ (persisted to call_transcripts + transcript_segments)
   │
┌────────────────────────────────────────┐
│ LLM audit (Gemma via OpenRouter)       │   ◄── google/gemma-4-31b-it:free
│  Inputs (TEXT ONLY — no audio):        │
│    - client parameters                 │
│    - call metadata                     │
│    - transcript                        │
│    - timestamped segments              │
│  Outputs:                              │
│    - parameter scores (binary)         │
│    - events (compliance, tone, …)     │
│    - summary, coaching, sentiment      │
└────────────────────────────────────────┘
   │
   ▼ (saveAuditResult: tx-safe write to ai_audits + ai_parameter_scores +
   │  call_events + ai_insights, updates calls.aiScore / sentiment / finalScore)
   │
ui (call detail page reads latest ai_audit row)
```

## Hard contracts

1. **Gemma never sees raw audio.** The OpenRouter request body contains
   only the text prompt (call metadata + parameters + transcript segments).
   `runLiveAuditForCall.ts` never holds an audio handle.
2. **One LLM call per call audit.** `buildLiveAuditPrompt` produces a single
   system + user message pair; the response is parsed once and persisted in
   one transaction.
3. **Binary scoring is enforced server-side.** Even if the model returns
   partial or invalid scores, `validateAuditResponse.ts` forces
   `awarded_score = max_score` for `result = pass` and `0` otherwise, and
   back-fills any active parameter the model omitted. No partial scores
   reach the database.
4. **STT and LLM are separate services.** STT lives in
   `src/services/stt/`; the LLM client lives in `src/services/llm/`. The
   audit orchestrator only consumes their outputs.
5. **API keys are read at request time and never logged.** A missing
   `OPENROUTER_API_KEY` surfaces as the error code
   `OPENROUTER_API_KEY_MISSING` and the primary UI button is disabled.

## Files

| File | Role |
| --- | --- |
| `getClientAuditParameters.ts` | Loads the active `ClientParameter[]` for a client. |
| `buildAuditPrompt.ts` | Legacy mock prompt; version `qms-audit-prompt-v1`. |
| `buildLiveAuditPrompt.ts` | Live Gemma prompt; version `qms-live-audit-prompt-v1`. |
| `mockAuditResponse.ts` | Deterministic mock response, used only when the dev mock button is invoked. |
| `validateAuditResponse.ts` | Enforces binary scoring + DB-safe shape. |
| `saveAuditResult.ts` | Transactional write: flips prior `isLatest`, increments `auditRunNo`, writes audit, scores, events, insights, updates `calls.*`. |
| `runAuditForCall.ts` | Mock orchestrator (dev fallback). |
| `runLiveAuditForCall.ts` | Live orchestrator (OpenRouter / Gemma). |
| `types.ts` | Raw + validated DTOs. |
| `index.ts` | Public re-exports. |

## UI behaviour

- Primary button on the call detail page is **Run AI Audit** / **Re-run AI
  Audit** (calls `runLiveAuditForCall`).
- Button is disabled when there is no transcript, no active parameters, or
  no OpenRouter key configured.
- A secondary **Dev: Mock Audit** button is shown only when
  `SHOW_MOCK_ACTIONS=true` or `NODE_ENV=development`. It does not appear in
  the normal production demo.
