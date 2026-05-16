import "server-only";
import { prisma } from "@/lib/db";
import { buildAuditPrompt, PROMPT_VERSION } from "./buildAuditPrompt";
import { getClientAuditParameters } from "./getClientAuditParameters";
import { generateMockAuditResponse } from "./mockAuditResponse";
import { saveAuditResult, type SaveAuditResult } from "./saveAuditResult";
import { validateAuditResponse } from "./validateAuditResponse";
import type {
  AuditCallContext,
  AuditMode,
  RawAuditResponse,
  ValidatedAuditResponse,
} from "./types";

export interface RunAuditOptions {
  mode?: AuditMode;
}

export interface RunAuditResult {
  audit: SaveAuditResult;
  promptVersion: string;
  prompt: string;
  rawResponse: RawAuditResponse;
  validated: ValidatedAuditResponse;
}

/**
 * High-level orchestrator: gather context → build prompt → get a response
 * (mock today, live OpenRouter later) → validate → persist.
 */
export async function runAuditForCall(
  callId: string,
  clientId: string,
  options: RunAuditOptions = {},
): Promise<RunAuditResult> {
  const mode = options.mode ?? "mock";

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
  if (!call) throw new Error("Call not found.");
  if (!call.transcript) throw new Error("Call has no transcript yet.");

  const parameters = await getClientAuditParameters(clientId);
  if (parameters.length === 0) {
    throw new Error("No active parameters for this client. Add parameters first.");
  }

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
      segments: call.transcript.segments.map((s) => ({
        sequence: s.sequence,
        speaker: s.speaker,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
      })),
    },
  };

  const prompt = buildAuditPrompt(ctx);

  let rawResponse: RawAuditResponse;
  let modelUsed: string | null;
  if (mode === "mock") {
    rawResponse = generateMockAuditResponse(ctx);
    modelUsed = "mock-audit-v1";
  } else {
    throw new Error("Live AI audit (OpenRouter) is not implemented yet.");
  }

  const validated = validateAuditResponse(rawResponse, ctx);

  const audit = await saveAuditResult({
    callId,
    ctx,
    validated,
    prompt,
    promptVersion: PROMPT_VERSION,
    rawResponse,
    auditMode: mode,
    modelUsed,
  });

  return {
    audit,
    promptVersion: PROMPT_VERSION,
    prompt,
    rawResponse,
    validated,
  };
}
