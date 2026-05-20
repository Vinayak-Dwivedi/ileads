import "server-only";
import { prisma } from "@/lib/db";
import {
  hasOpenRouterKey,
  loadOpenRouterConfig,
  openrouterChat,
} from "@/services/llm";
import { buildLiveAuditPrompt, LIVE_PROMPT_VERSION } from "./buildLiveAuditPrompt";
import { getClientAuditParameters } from "./getClientAuditParameters";
import { saveAuditResult, type SaveAuditResult } from "./saveAuditResult";
import { validateAuditResponse } from "./validateAuditResponse";
import type {
  AuditCallContext,
  RawAuditResponse,
  ValidatedAuditResponse,
} from "./types";

export interface LiveAuditUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface RunLiveAuditResult {
  audit: SaveAuditResult;
  promptVersion: string;
  prompt: string;
  rawResponse: RawAuditResponse;
  validated: ValidatedAuditResponse;
  model: string;
  primaryModel: string;
  /** True when OpenRouter routed past the configured primary onto a fallback model. */
  usedFallback: boolean;
  usage: LiveAuditUsage | null;
  attempts: number;
}

export class LiveAuditError extends Error {
  code: string;
  status?: number;
  constructor(code: string, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "LiveAuditError";
  }
}

/**
 * Run a LIVE AI audit (OpenRouter / Gemma) for a single call.
 *
 * Flow:
 *   1. Load call, client, transcript, segments.
 *   2. Load active client parameters.
 *   3. Validate preconditions (transcript exists, parameters exist,
 *      OpenRouter API key present).
 *   4. Build system + user prompt (TEXT ONLY — no audio).
 *   5. Call OpenRouter chat completions.
 *   6. Parse JSON safely.
 *   7. Validate via shared validator (binary scoring enforced).
 *   8. Save via shared saveAuditResult (ai_audits + ai_parameter_scores +
 *      call_events + ai_insights + denormalised call.aiScore/sentiment/finalScore).
 */
export async function runLiveAuditForCall(
  callId: string,
  clientId: string,
): Promise<RunLiveAuditResult> {
  const config = loadOpenRouterConfig();
  if (!hasOpenRouterKey(config)) {
    throw new LiveAuditError(
      "OPENROUTER_API_KEY_MISSING",
      "OpenRouter API key missing. Add OPENROUTER_API_KEY to .env and restart PM2.",
    );
  }

  const call = await prisma.call.findFirst({
    where: { id: callId, clientId },
    include: {
      client: true,
      campaign: { select: { name: true } },
      agent: { select: { name: true } },
      team: { select: { name: true } },
      transcript: { include: { segments: { orderBy: { sequence: "asc" } } } },
    },
  });
  if (!call) {
    throw new LiveAuditError("CALL_NOT_FOUND", "Call not found.");
  }
  if (!call.transcript) {
    throw new LiveAuditError(
      "NO_TRANSCRIPT",
      "Call has no transcript yet. Run transcription first.",
    );
  }

  const parameters = await getClientAuditParameters(clientId);
  if (parameters.length === 0) {
    throw new LiveAuditError(
      "NO_PARAMETERS",
      "No active audit parameters for this client. Add parameters before running the audit.",
    );
  }

  const speakerSources = call.transcript.segments
    .map((s) => s.speakerSource)
    .filter((source): source is string => Boolean(source));
  const hasEstimatedSarvamLabels = speakerSources.some((source) =>
    source.startsWith("sarvam_diarization_heuristic") || source.startsWith("sarvam_diarization_mapped"),
  );
  const speakerLabelNote = call.transcript.speakerLabelsCorrected
    ? "Speaker label note: Speaker labels were manually corrected before audit."
    : hasEstimatedSarvamLabels
      ? "Speaker label note: Speaker labels are estimated from diarization and may be imperfect."
      : null;

  const ctx: AuditCallContext = {
    client: { id: call.client.id, name: call.client.name },
    call: {
      id: call.id,
      externalCallId: call.externalCallId,
      direction: call.direction,
      durationSeconds: call.durationSeconds,
      language: call.language,
      disposition: call.disposition,
      callerNumber: call.callerNumber,
      calleeNumber: call.calleeNumber,
      customerName: call.customerName,
      callStartedAt: call.callStartedAt,
      callEndedAt: call.callEndedAt,
      campaignName: call.campaign?.name ?? null,
      agentName: call.agent?.name ?? null,
      teamName: call.team?.name ?? null,
    },
    parameters,
    transcript: {
      fullText: call.transcript.fullText,
      speakerLabelNote,
      segments: call.transcript.segments.map((s) => ({
        sequence: s.sequence,
        speaker: s.speaker,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
        channel: s.channel,
        speakerSource: s.speakerSource,
      })),
    },
  };

  // Load the client's active editable prompt template if any. Audit at run
  // time uses the custom template; the validator + saver remain unchanged so
  // binary scoring stays enforced even if the template is edited.
  const customPromptRow = await prisma.clientAuditPrompt.findFirst({
    where: { clientId, isActive: true },
    orderBy: { versionNo: "desc" },
    select: { promptText: true, versionNo: true },
  });
  const customTemplate = customPromptRow?.promptText ?? null;

  const { system, user, usedCustomTemplate } = buildLiveAuditPrompt(ctx, customTemplate);
  // For DB storage we keep the combined prompt as a single string.
  const combinedPrompt = `### SYSTEM\n${system}\n\n### USER\n${user}`;

  const outcome = await openrouterChat<RawAuditResponse>(
    {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
      maxTokens: 4096,
      requestJson: true,
    },
    config,
  );

  if (!outcome.ok) {
    throw new LiveAuditError(outcome.code, outcome.message, outcome.status);
  }

  if (!outcome.parsed) {
    throw new LiveAuditError(
      "OPENROUTER_INVALID_JSON",
      `OpenRouter response did not contain valid JSON. First 200 chars: ${outcome.content.slice(0, 200)}`,
    );
  }

  const rawResponse: RawAuditResponse = outcome.parsed;
  const validated = validateAuditResponse(rawResponse, ctx);

  const audit = await saveAuditResult({
    callId,
    ctx,
    validated,
    prompt: combinedPrompt,
    promptVersion: LIVE_PROMPT_VERSION,
    rawResponse: {
      provider: "openrouter",
      model: outcome.model,
      usage: outcome.usage,
      content: outcome.content,
      parsed: rawResponse,
      attempts: outcome.attempts,
      raw: outcome.rawResponse,
      promptTemplateSource: usedCustomTemplate
        ? `custom (v${customPromptRow?.versionNo})`
        : "default",
    },
    auditMode: "live",
    modelUsed: outcome.model,
  });

  // OpenRouter echoes a dated variant like "google/gemma-4-31b-it-20260402:free"
  // when the primary is used and "google/gemma-4-26b-a4b-it-20260403:free" when
  // a fallback is routed. Compare against the configured primary's family stem
  // (everything before "-YYYYMMDD" or ":").
  const primaryStem = config.model.replace(/:.*$/, "");
  const usedFallback = !outcome.model.startsWith(primaryStem);

  return {
    audit,
    promptVersion: LIVE_PROMPT_VERSION,
    prompt: combinedPrompt,
    rawResponse,
    validated,
    model: outcome.model,
    primaryModel: config.model,
    usedFallback,
    usage: outcome.usage ?? null,
    attempts: outcome.attempts,
  };
}
