// Public surface of the AI audit pipeline. Server-only.
//
// Pipeline:
//   1. getClientAuditParameters(clientId)   -> active ClientParameter[]
//   2. buildAuditPrompt(ctx)                -> prompt string
//   3. mock/live response                   -> RawAuditResponse
//   4. validateAuditResponse(raw, ctx)      -> ValidatedAuditResponse
//   5. saveAuditResult(...)                 -> writes ai_audits / ai_parameter_scores
//                                              / call_events / calls (in a tx)
//
// Binary scoring is enforced inside validateAuditResponse — nothing
// downstream may trust raw model output.

export { getClientAuditParameters } from "./getClientAuditParameters";
export { buildAuditPrompt, PROMPT_VERSION } from "./buildAuditPrompt";
export { buildLiveAuditPrompt, LIVE_PROMPT_VERSION } from "./buildLiveAuditPrompt";
export { generateMockAuditResponse } from "./mockAuditResponse";
export { validateAuditResponse } from "./validateAuditResponse";
export { saveAuditResult } from "./saveAuditResult";
export { runAuditForCall } from "./runAuditForCall";
export { runLiveAuditForCall, LiveAuditError } from "./runLiveAuditForCall";
export type { RunLiveAuditResult, LiveAuditUsage } from "./runLiveAuditForCall";
export type {
  AuditCallContext,
  AuditMode,
  RawAuditResponse,
  ValidatedAuditResponse,
  ValidatedParameterScore,
  ValidatedEvent,
} from "./types";
