"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { runAuditForCall, runLiveAuditForCall, LiveAuditError } from "@/services/audit";
import { runMockTranscriptionForCall, runLocalSttForCall } from "@/services/transcription";
import { updateSegmentSpeaker } from "@/services/transcription/updateSegmentSpeaker";
import { isMockMode, SttError } from "@/services/stt";
import {
  acquireProcessingLock,
  failProcessingLock,
  ProcessingLockedError,
  releaseProcessingLock,
} from "@/lib/processing-lock";
import type { SpeakerRole } from "@prisma/client";

export async function saveManualReview(formData: FormData) {
  const session = await requireSession();
  const callId = String(formData.get("callId") ?? "");
  const reviewerName = String(formData.get("reviewerName") ?? "").trim();
  const status = String(formData.get("status") ?? "PENDING") as
    | "PENDING"
    | "IN_PROGRESS"
    | "COMPLETED";
  const disposition = String(formData.get("disposition") ?? "").trim();
  const scoreRaw = String(formData.get("score") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!callId) throw new Error("Missing call id.");
  if (!reviewerName) throw new Error("Reviewer name is required.");

  const score = scoreRaw === "" ? null : Number(scoreRaw);
  if (score != null && (Number.isNaN(score) || score < 0 || score > 100)) {
    throw new Error("Manual score must be between 0 and 100.");
  }

  const call = await prisma.call.findFirst({
    where: { id: callId, clientId: session.clientId },
    select: { id: true, aiScore: true, manualReviews: { take: 1, orderBy: { createdAt: "desc" } } },
  });
  if (!call) throw new Error("Call not found.");

  const existing = call.manualReviews[0];

  await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.manualReview.update({
        where: { id: existing.id },
        data: {
          reviewerName,
          status,
          score: score ?? null,
          maxScore: score != null ? 100 : null,
          scorePercent: score ?? null,
          notes: notes || null,
          startedAt: existing.startedAt ?? new Date(),
          completedAt: status === "COMPLETED" ? new Date() : null,
        },
      });
    } else {
      await tx.manualReview.create({
        data: {
          callId,
          reviewerName,
          status,
          score: score ?? null,
          maxScore: score != null ? 100 : null,
          scorePercent: score ?? null,
          notes: notes || null,
          startedAt: new Date(),
          completedAt: status === "COMPLETED" ? new Date() : null,
        },
      });
    }

    await tx.call.update({
      where: { id: callId },
      data: {
        manualScore: score,
        manualDisposition: disposition || null,
        finalScore: score ?? call.aiScore ?? null,
      },
    });

    await tx.callEvent.create({
      data: {
        callId,
        eventType: status === "COMPLETED" ? "MANUAL_REVIEW_COMPLETED" : "MANUAL_REVIEW_STARTED",
        payload: { reviewerName, status, score, disposition },
      },
    });
  });

  revalidatePath(`/calls/${callId}`);
  revalidatePath("/calls");
  revalidatePath("/dashboard");
}

export interface MockAuditDebugInfo {
  promptVersion: string;
  prompt: string;
  rawResponse: unknown;
  validated: unknown;
  warnings: string[];
  auditId: string;
  auditRunNo: number;
}

export async function runMockTranscription(callId: string) {
  if (!callId) throw new Error("Missing call id.");
  const session = await requireSession();
  const result = await runMockTranscriptionForCall(callId, session.clientId);
  revalidatePath(`/calls/${callId}`);
  revalidatePath("/calls");
  revalidatePath("/dashboard");
  return result;
}

export interface LocalSttAttempt {
  model: string;
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  qualityFlags?: string[];
  durationMs: number;
}

export interface LocalSttActionResult {
  ok: boolean;
  transcriptId?: string;
  segmentCount?: number;
  modelUsed?: string;
  winningModel?: string;
  usedFallback?: boolean;
  language?: string;
  provider?: string;
  attempts?: LocalSttAttempt[];
  fallbackReason?: string | null;
  attemptedModels?: string[];
  qualityFlags?: string[];
  speakerLabelWarning?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export async function runLocalSttTranscription(callId: string): Promise<LocalSttActionResult> {
  if (!callId) throw new Error("Missing call id.");
  const session = await requireSession();

  if (isMockMode()) {
    return {
      ok: false,
      errorCode: "MOCK_MODE",
      errorMessage: "Local STT is disabled. Set MOCK_STT=false in .env and restart PM2.",
    };
  }

  try {
    await acquireProcessingLock(callId, "transcribing");
  } catch (e) {
    if (e instanceof ProcessingLockedError) {
      return { ok: false, errorCode: e.code, errorMessage: e.message };
    }
    throw e;
  }

  try {
    const result = await runLocalSttForCall(callId, session.clientId);
    await releaseProcessingLock(callId);
    revalidatePath(`/calls/${callId}`);
    revalidatePath("/calls");
    revalidatePath("/dashboard");
    return { ok: true, ...result };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Local STT failed.";
    await failProcessingLock(callId, message);
    revalidatePath(`/calls/${callId}`);
    if (e instanceof SttError) {
      const attempts =
        (e.details as { attempts?: LocalSttAttempt[] } | undefined)?.attempts;
      return { ok: false, errorCode: e.code, errorMessage: e.message, attempts };
    }
    return { ok: false, errorCode: "UNKNOWN", errorMessage: message };
  }
}

export async function runMockAudit(callId: string): Promise<MockAuditDebugInfo> {
  if (!callId) throw new Error("Missing call id.");
  const session = await requireSession();
  const result = await runAuditForCall(callId, session.clientId, { mode: "mock" });
  revalidatePath(`/calls/${callId}`);
  revalidatePath("/calls");
  revalidatePath("/dashboard");
  return {
    promptVersion: result.promptVersion,
    prompt: result.prompt,
    rawResponse: result.rawResponse,
    validated: result.validated,
    warnings: result.validated.warnings,
    auditId: result.audit.auditId,
    auditRunNo: result.audit.auditRunNo,
  };
}

export interface LiveAuditActionResult {
  ok: boolean;
  errorCode?: string;
  /** Safe, user-facing error message — never contains the API key or raw response. */
  errorMessage?: string;
  auditId?: string;
  auditRunNo?: number;
  model?: string;
  primaryModel?: string;
  usedFallback?: boolean;
  scorePercent?: number;
  overallScore?: number;
  maxPossibleScore?: number;
  sentiment?: string;
  hasComplianceIssue?: boolean;
  complianceSeverity?: string;
  warnings?: string[];
  parameterCount?: number;
  eventCount?: number;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
  attempts?: number;
}

function safeAuditErrorMessage(code: string, raw: string | undefined, status?: number): string {
  switch (code) {
    case "OPENROUTER_API_KEY_MISSING":
      return "OpenRouter API key missing. Add it in .env and restart PM2.";
    case "OPENROUTER_HTTP_ERROR":
      if (status === 429) {
        return "OpenRouter rate limit reached. Please wait a minute and try again.";
      }
      if (status === 401 || status === 403) {
        return "OpenRouter rejected the API key. Check OPENROUTER_API_KEY in .env.";
      }
      if (status && status >= 500) {
        return `OpenRouter service unavailable (HTTP ${status}). Please try again.`;
      }
      return `OpenRouter request failed${status ? ` (HTTP ${status})` : ""}. Please try again.`;
    case "OPENROUTER_TIMEOUT":
      return "OpenRouter request timed out. Please try again.";
    case "OPENROUTER_NETWORK":
      return "OpenRouter could not be reached. Check the server's outbound network and try again.";
    case "OPENROUTER_EMPTY_RESPONSE":
      return "OpenRouter returned an empty response. Please retry.";
    case "OPENROUTER_INVALID_JSON":
      return "AI returned an invalid response. Please retry.";
    case "NO_TRANSCRIPT":
      return "Run transcription first.";
    case "NO_PARAMETERS":
      return "Add audit parameters first.";
    case "CALL_NOT_FOUND":
      return "Call not found.";
    default:
      return raw && raw.length <= 200 ? raw : "Live AI audit failed. Please retry.";
  }
}

export async function runLiveAudit(callId: string): Promise<LiveAuditActionResult> {
  if (!callId) throw new Error("Missing call id.");
  const session = await requireSession();

  try {
    await acquireProcessingLock(callId, "auditing");
  } catch (e) {
    if (e instanceof ProcessingLockedError) {
      return { ok: false, errorCode: e.code, errorMessage: e.message };
    }
    throw e;
  }

  try {
    const result = await runLiveAuditForCall(callId, session.clientId);
    await releaseProcessingLock(callId);
    revalidatePath(`/calls/${callId}`);
    revalidatePath("/calls");
    revalidatePath("/dashboard");
    return {
      ok: true,
      auditId: result.audit.auditId,
      auditRunNo: result.audit.auditRunNo,
      model: result.model,
      primaryModel: result.primaryModel,
      usedFallback: result.usedFallback,
      scorePercent: result.validated.scorePercent,
      overallScore: result.validated.overallScore,
      maxPossibleScore: result.validated.maxPossibleScore,
      sentiment: result.validated.sentiment,
      hasComplianceIssue: result.validated.hasComplianceIssue,
      complianceSeverity: result.validated.complianceSeverity,
      warnings: result.validated.warnings,
      parameterCount: result.validated.parameterScores.length,
      eventCount: result.validated.events.length,
      usage: result.usage,
      attempts: result.attempts,
    };
  } catch (e) {
    const message =
      e instanceof LiveAuditError
        ? safeAuditErrorMessage(e.code, e.message, e.status)
        : safeAuditErrorMessage("UNKNOWN", e instanceof Error ? e.message : undefined);
    await failProcessingLock(callId, message);
    revalidatePath(`/calls/${callId}`);
    if (e instanceof LiveAuditError) {
      return { ok: false, errorCode: e.code, errorMessage: message };
    }
    return { ok: false, errorCode: "UNKNOWN", errorMessage: message };
  }
}

function parseSpeaker(value: string): SpeakerRole | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "agent") return "AGENT";
  if (normalized === "customer") return "CUSTOMER";
  if (normalized === "unknown") return "UNKNOWN";
  return null;
}

export async function updateTranscriptSegmentSpeaker(
  segmentId: string,
  speaker: string,
): Promise<{
  ok: boolean;
  callId?: string;
  oldSpeaker?: SpeakerRole;
  newSpeaker?: SpeakerRole;
  needsAuditRerun?: boolean;
  error?: string;
}> {
  if (!segmentId) throw new Error("Missing segment id.");
  const session = await requireSession();
  const nextSpeaker = parseSpeaker(speaker);
  if (!nextSpeaker) return { ok: false, error: "Invalid speaker value." };

  const segment = await prisma.transcriptSegment.findUnique({
    where: { id: segmentId },
    select: { transcript: { select: { call: { select: { id: true, clientId: true } } } } },
  });

  if (!segment || segment.transcript.call.clientId !== session.clientId) {
    return { ok: false, error: "Transcript segment not found." };
  }

  const callId = segment.transcript.call.id;
  const result = await updateSegmentSpeaker({
    segmentId,
    speaker: nextSpeaker,
    correctedBy: session.accessId,
  });

  revalidatePath(`/calls/${callId}`);
  revalidatePath("/calls");
  revalidatePath("/dashboard");
  return result;
}

export interface ProcessDemoCallResult {
  ok: boolean;
  transcription?: {
    ran: boolean;
    ok?: boolean;
    skippedReason?: string;
    winningModel?: string;
    usedFallback?: boolean;
    segmentCount?: number;
    errorCode?: string;
    errorMessage?: string;
  };
  audit?: {
    ran: boolean;
    ok?: boolean;
    skippedReason?: string;
    model?: string;
    usedFallback?: boolean;
    scorePercent?: number;
    auditRunNo?: number;
    errorCode?: string;
    errorMessage?: string;
  };
  errorMessage?: string;
}

/**
 * Stitched convenience action used by the "Process Demo Call" button.
 *
 *   - If no transcript: run live STT first.
 *   - If STT fails, stop before running the audit.
 *   - Then run the live AI audit (will skip if there are no active parameters
 *     or no OpenRouter key, and surface a clear message).
 *
 * Returns granular state so the UI can show step-by-step progress.
 */
export async function processDemoCall(callId: string): Promise<ProcessDemoCallResult> {
  if (!callId) throw new Error("Missing call id.");
  const session = await requireSession();

  const callBefore = await prisma.call.findFirst({
    where: { id: callId, clientId: session.clientId },
    select: { id: true, audioPath: true, transcript: { select: { id: true } } },
  });
  if (!callBefore) {
    return { ok: false, errorMessage: "Call not found." };
  }

  // Single lock for the whole stitched operation. Both stages run inside
  // it so the UI shows "processing_demo" throughout and other actions are
  // blocked.
  try {
    await acquireProcessingLock(callId, "processing_demo");
  } catch (e) {
    if (e instanceof ProcessingLockedError) {
      return { ok: false, errorMessage: e.message };
    }
    throw e;
  }

  let transcription: ProcessDemoCallResult["transcription"];
  if (callBefore.transcript) {
    transcription = { ran: false, skippedReason: "Transcript already exists." };
  } else if (!callBefore.audioPath) {
    await failProcessingLock(callId, "No audio file on call.");
    revalidatePath(`/calls/${callId}`);
    return {
      ok: false,
      transcription: { ran: false, skippedReason: "No audio file on call." },
      errorMessage: "No audio file on call. Re-upload before processing.",
    };
  } else if (isMockMode()) {
    await failProcessingLock(callId, "Local STT disabled.");
    revalidatePath(`/calls/${callId}`);
    return {
      ok: false,
      transcription: {
        ran: false,
        skippedReason: "Local STT disabled (MOCK_STT=true).",
      },
      errorMessage: "Local STT is disabled. Set MOCK_STT=false in .env and restart PM2.",
    };
  } else {
    try {
      const sttResult = await runLocalSttForCall(callId, session.clientId);
      transcription = {
        ran: true,
        ok: true,
        winningModel: sttResult.winningModel,
        usedFallback: sttResult.usedFallback,
        segmentCount: sttResult.segmentCount,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Local STT failed.";
      await failProcessingLock(callId, msg);
      revalidatePath(`/calls/${callId}`);
      if (e instanceof SttError) {
        return {
          ok: false,
          transcription: { ran: true, ok: false, errorCode: e.code, errorMessage: e.message },
          errorMessage: `Transcription failed (${e.code}). Audit was not started.`,
        };
      }
      return {
        ok: false,
        transcription: { ran: true, ok: false, errorCode: "UNKNOWN", errorMessage: msg },
        errorMessage: "Transcription failed. Audit was not started.",
      };
    }
  }

  // -------- Stage 2: audit --------
  try {
    const auditResult = await runLiveAuditForCall(callId, session.clientId);
    await releaseProcessingLock(callId);
    revalidatePath(`/calls/${callId}`);
    revalidatePath("/calls");
    revalidatePath("/dashboard");
    return {
      ok: true,
      transcription,
      audit: {
        ran: true,
        ok: true,
        model: auditResult.model,
        usedFallback: auditResult.usedFallback,
        scorePercent: auditResult.validated.scorePercent,
        auditRunNo: auditResult.audit.auditRunNo,
      },
    };
  } catch (e) {
    const msg =
      e instanceof LiveAuditError
        ? safeAuditErrorMessage(e.code, e.message, e.status)
        : safeAuditErrorMessage("UNKNOWN", e instanceof Error ? e.message : undefined);
    await failProcessingLock(callId, msg);
    revalidatePath(`/calls/${callId}`);
    if (e instanceof LiveAuditError) {
      return {
        ok: false,
        transcription,
        audit: { ran: true, ok: false, errorCode: e.code, errorMessage: msg },
        errorMessage: msg,
      };
    }
    return {
      ok: false,
      transcription,
      audit: { ran: true, ok: false, errorCode: "UNKNOWN", errorMessage: msg },
      errorMessage: "Live AI audit failed.",
    };
  }
}

/**
 * Admin/dev convenience: clear a stuck processing lock on a call.
 * Used by the call-detail page when processingStatus is non-idle but the
 * operation never released its lock (rare; usually only after a server crash).
 */
export async function resetProcessingState(callId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!callId) throw new Error("Missing call id.");
    const session = await requireSession();
    const c = await prisma.call.findFirst({
      where: { id: callId, clientId: session.clientId },
      select: { id: true },
    });
    if (!c) return { ok: false, error: "Call not found." };
    await prisma.call.update({
      where: { id: callId },
      data: { processingStatus: "idle", processingStartedAt: null, processingError: null },
    });
    revalidatePath(`/calls/${callId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reset failed." };
  }
}

export async function addCallNote(formData: FormData) {
  const session = await requireSession();
  const callId = String(formData.get("callId") ?? "");
  const authorName = String(formData.get("authorName") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!callId || !authorName || !body) {
    throw new Error("Author name and note text are required.");
  }

  const call = await prisma.call.findFirst({
    where: { id: callId, clientId: session.clientId },
    select: { id: true, transcript: { select: { id: true } } },
  });
  if (!call) throw new Error("Call not found.");
  if (!call.transcript) {
    throw new Error("No transcript available. Run transcription first when STT is enabled.");
  }

  await prisma.$transaction([
    prisma.callNote.create({
      data: { callId, authorName, body },
    }),
    prisma.callEvent.create({
      data: { callId, eventType: "NOTE_ADDED", payload: { authorName } },
    }),
  ]);

  revalidatePath(`/calls/${callId}`);
}
