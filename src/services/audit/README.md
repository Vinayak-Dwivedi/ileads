# AI audit pipeline

Server-only services that drive the call-quality audit. The current
implementation runs in **mock** mode — no external API calls — but the
service boundaries are designed so that swapping in real STT + LLM later is
a localised change.

```
audio file
   │
   ▼
┌────────────────────────────────────────┐
│ STT (Speech-to-Text)                   │   ◄── Whisper or equivalent
│  - full transcript                     │       (NOT IMPLEMENTED)
│  - timestamped segments                │
│  - speaker labels (when available)     │
│  - per-segment confidence (when avail) │
└────────────────────────────────────────┘
   │
   ▼ (persisted to call_transcripts + transcript_segments)
   │
┌────────────────────────────────────────┐
│ LLM audit (Gemma / Gemma4)             │   ◄── via OpenRouter or local
│  Inputs:                               │       inference (NOT IMPLEMENTED;
│    - client parameters                 │       currently a deterministic
│    - call metadata                     │       mock)
│    - transcript                        │
│    - timestamped segments              │
│  Outputs:                              │
│    - parameter scores (binary)         │
│    - events (compliance, tone, …)      │
│    - summary, coaching, sentiment      │
└────────────────────────────────────────┘
   │
   ▼ (saveAuditResult: tx-safe write to ai_audits + ai_parameter_scores +
   │  call_events, updates calls.aiScore / sentiment / finalScore)
   │
ui (call detail page reads latest ai_audit row)
```

## Hard contracts

1. **Gemma never sees raw audio.** Audio is converted to text by the STT
   stage first. Gemma only receives `{client parameters, call metadata,
   transcript, segments}`. This is enforced at the call site
   (`runAuditForCall.ts`) which never receives an audio handle.
2. **One LLM call per call audit.** `buildAuditPrompt` produces a single,
   self-contained prompt; the response is parsed once and persisted in one
   transaction. This is the cost-control target for the live integration.
3. **Binary scoring is enforced server-side.** Even if the LLM returns
   partial or invalid scores, `validateAuditResponse.ts` forces
   `awarded_score = max_score` for `result = pass` and `0` otherwise, and
   back-fills any active parameter the model omitted. No partial scores
   reach the database.
4. **STT vs LLM are separate services.** When the real implementations
   land, expect two files: a `src/services/stt/` module (Whisper or
   equivalent, returns a transcript object), and a live mode inside
   `runAuditForCall(callId, clientId, { mode: 'live' })` that swaps the
   mock response generator for an OpenRouter call. The validator and saver
   stay unchanged.

## What is NOT implemented in this scaffold

- Live Whisper / STT integration. The seed already inserts hand-written
  transcripts so the rest of the pipeline can be exercised.
- Live Gemma / Gemma4 / OpenRouter call. `runAuditForCall` throws when
  invoked with `{ mode: 'live' }`. The mock mode is fully functional and is
  what the "Run Mock AI Audit" button on the call detail page invokes.
- Audio upload, audio storage, audio retention. There is no `recordings`
  table — the `Call.recordingUrl` column is the placeholder.

## Files

| File | Role |
| --- | --- |
| `getClientAuditParameters.ts` | Loads the active `ClientParameter[]` for a client. |
| `buildAuditPrompt.ts` | Builds the Gemma prompt; version `qms-audit-prompt-v1`. |
| `mockAuditResponse.ts` | Deterministic mock response. Includes deliberate violations so the validator is exercised. |
| `validateAuditResponse.ts` | Enforces binary scoring + DB-safe shape. |
| `saveAuditResult.ts` | Transactional write: flips prior `isLatest`, increments `auditRunNo`, writes audit, scores, events, updates `calls.*`. |
| `runAuditForCall.ts` | Orchestrator. |
| `types.ts` | Raw + validated DTOs. |
| `index.ts` | Public re-exports. |

## When live STT + Gemma are wired

1. Add `src/services/stt/transcribeCall.ts` that takes an audio handle and
   returns `{ fullText, segments[] }`. Persist via a new server action
   (`transcribeCall(callId)`) into `call_transcripts` / `transcript_segments`.
2. In `runAuditForCall`, change the `mode === "live"` branch to call
   OpenRouter (or local Gemma) with the prompt produced by
   `buildAuditPrompt`. Parse the JSON response into a `RawAuditResponse`.
   Everything downstream (`validateAuditResponse`, `saveAuditResult`) stays
   as-is.
3. The "Run Mock AI Audit" button in the UI flips to "Run AI Audit" by
   changing the action argument from `{ mode: "mock" }` to
   `{ mode: "live" }` (or by exposing both).
