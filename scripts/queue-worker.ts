// Background queue worker for call processing.
//
// Polls for calls left in processingStatus="uploaded" by the Excel import,
// runs STT (Sarvam) then live AI audit (OpenRouter/Gemini), and releases the
// processing lock.
//
// Supports concurrent processing of multiple calls in parallel, controlled by
// the QUEUE_CONCURRENCY env var (default 3). Also supports automatic retry of
// transient audit failures (HTTP 429/500/timeout) up to MAX_RETRIES times with
// exponential backoff.
//
// Started by PM2 (see ecosystem.config.js) alongside the web app, or directly
// via `npm run worker:queue` for development.
//
// Env:
//   QUEUE_WORKER_POLL_MS       default 5000  — sleep between empty polls
//   QUEUE_CONCURRENCY          default 3     — max parallel call processing
//   QUEUE_MAX_RETRIES          default 3     — max audit retry attempts
//   QUEUE_WORKER_RECOVER_STALE default true  — on startup, reset calls stuck
//                                              in transcribing/auditing past
//                                              the 30 min stale window back to
//                                              "uploaded" so they re-enter the
//                                              queue.

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runLocalSttForCall, runMockTranscriptionForCall } from "../src/services/transcription";
import { runLiveAuditForCall, LiveAuditError } from "../src/services/audit";
import { SttError } from "../src/services/stt";
import {
  releaseProcessingLock,
  failProcessingLock,
} from "../src/lib/processing-lock";
import { publishCallEvent } from "../src/lib/event-bus";
import { publishWebhookEvent } from "../src/lib/webhooks";
import { trackQuotaUsage } from "../src/lib/quotas";

const POLL_MS = (() => {
  const v = Number(process.env.QUEUE_WORKER_POLL_MS ?? "5000");
  return Number.isFinite(v) && v >= 500 ? v : 5000;
})();
const CONCURRENCY = (() => {
  const v = Number(process.env.QUEUE_CONCURRENCY ?? "3");
  return Number.isFinite(v) && v >= 1 ? Math.min(v, 10) : 3;
})();
const MAX_RETRIES = (() => {
  const v = Number(process.env.QUEUE_MAX_RETRIES ?? "3");
  return Number.isFinite(v) && v >= 0 ? v : 3;
})();
const STALE_LOCK_MS = 30 * 60 * 1000;

let shuttingDown = false;
/** Number of calls currently being processed. */
let activeCount = 0;

function log(msg: string, extra?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  if (extra) {
    console.log(`[${ts}] ${msg}`, JSON.stringify(extra));
  } else {
    console.log(`[${ts}] ${msg}`);
  }
}

function logErr(msg: string, err: unknown): void {
  const ts = new Date().toISOString();
  const detail = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`[${ts}] ${msg}\n${detail}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff for retries: 30s, 90s, 270s capped at 5 min. */
function retryBackoffMs(retryCount: number): number {
  return Math.min(30_000 * Math.pow(3, retryCount), 5 * 60 * 1000);
}

/**
 * On startup, return any call stuck in a "running" status past the stale
 * window back to "uploaded" so we re-process it. Matches STALE_LOCK_MS used
 * by processing-lock.ts.
 */
async function recoverStaleCalls(): Promise<void> {
  if ((process.env.QUEUE_WORKER_RECOVER_STALE ?? "true") === "false") return;
  const cutoff = new Date(Date.now() - STALE_LOCK_MS);
  const res = await prisma.call.updateMany({
    where: {
      processingStatus: { in: ["transcribing", "auditing", "processing_demo"] },
      processingStartedAt: { lt: cutoff },
    },
    data: {
      processingStatus: "uploaded",
      processingStartedAt: null,
      processingError: "Recovered by queue-worker after stale lock.",
    },
  });
  if (res.count > 0) {
    log(`Recovered ${res.count} stale call(s) back to "uploaded".`);
  }
}

/**
 * Atomically claim up to `limit` calls in processingStatus="uploaded".
 * Uses a select-then-guarded-updateMany so concurrent workers cannot
 * double-claim the same call.
 */
async function claimBatch(
  limit: number,
): Promise<{ id: string; clientId: string }[]> {
  if (limit <= 0) return [];

  const candidates = await prisma.call.findMany({
    where: {
      processingStatus: "uploaded",
      // Only pick calls whose processingStartedAt is null (new) or in the past
      // (retry backoff elapsed). Calls with future processingStartedAt are
      // waiting for their retry backoff to expire.
      OR: [
        { processingStartedAt: null },
        { processingStartedAt: { lte: new Date() } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, clientId: true },
  });

  const claimed: { id: string; clientId: string }[] = [];
  for (const candidate of candidates) {
    const result = await prisma.call.updateMany({
      where: {
        id: candidate.id,
        processingStatus: "uploaded",
      },
      data: {
        processingStatus: "transcribing",
        processingStartedAt: new Date(),
        processingError: null,
      },
    });
    if (result.count > 0) {
      claimed.push(candidate);
    }
  }
  return claimed;
}

/** Check if an error code represents a transient/retryable failure. */
function isTransientError(code: string): boolean {
  return (
    code.includes("TIMEOUT") ||
    code.includes("HTTP_ERROR") ||
    code.includes("NETWORK") ||
    code.includes("EMPTY_RESPONSE")
  );
}

async function processCall(callId: string, clientId: string): Promise<void> {
  log(`Processing call`, { callId });
  publishCallEvent(callId, { type: "status", status: "transcribing" });

  // Stage 1 — transcription. Lock is already at "transcribing" from claim.
  try {
    const isMock = process.env.MOCK_STT === "true" || process.env.MOCK_STT === "1";
    const sttRaw = isMock
      ? await runMockTranscriptionForCall(callId, clientId)
      : await runLocalSttForCall(callId, clientId);

    const stt = {
      winningModel: (sttRaw as any).winningModel || sttRaw.modelUsed || "mock-model",
      segmentCount: sttRaw.segmentCount,
      usedFallback: (sttRaw as any).usedFallback || false,
    };

    log(`Transcription done`, {
      callId,
      model: stt.winningModel,
      segments: stt.segmentCount,
      fallback: stt.usedFallback,
    });
    publishCallEvent(callId, {
      type: "transcribed",
      model: stt.winningModel,
      segments: stt.segmentCount,
      usedFallback: stt.usedFallback,
    });
    void publishWebhookEvent(clientId, "call.transcript.ready", {
      callId,
      model: stt.winningModel,
      segments: stt.segmentCount,
      usedFallback: stt.usedFallback,
    });
    // STT duration metering: query the call to get the recorded duration.
    void prisma.call
      .findUnique({ where: { id: callId }, select: { durationSeconds: true } })
      .then((c) => {
        const minutes = c?.durationSeconds ? Math.max(1, Math.ceil(c.durationSeconds / 60)) : 1;
        return trackQuotaUsage(clientId, "STT_MINUTES_PER_DAY", minutes);
      })
      .catch(() => {});
  } catch (e) {
    const code = e instanceof SttError ? e.code : "UNKNOWN";
    const msg = e instanceof Error ? e.message : "Local STT failed.";
    await failProcessingLock(callId, `STT ${code}: ${msg}`);
    publishCallEvent(callId, { type: "failed", stage: "stt", code, message: msg });
    void publishWebhookEvent(clientId, "call.audit.failed", {
      callId,
      stage: "stt",
      code,
      message: msg,
    });
    log(`Transcription failed`, { callId, code, msg });
    return;
  }

  // Stage 2 — audit. Move status to "auditing" so the UI reflects the stage.
  await prisma.call.update({
    where: { id: callId },
    data: { processingStatus: "auditing", processingStartedAt: new Date() },
  });
  publishCallEvent(callId, { type: "status", status: "auditing" });

  try {
    const audit = await runLiveAuditForCall(callId, clientId);
    await releaseProcessingLock(callId);
    publishCallEvent(callId, {
      type: "completed",
      auditRunNo: audit.audit.auditRunNo,
      model: audit.model,
      scorePercent: audit.validated.scorePercent,
    });
    void publishWebhookEvent(clientId, "call.audit.completed", {
      callId,
      auditRunNo: audit.audit.auditRunNo,
      model: audit.model,
      scorePercent: audit.validated.scorePercent,
    });
    void trackQuotaUsage(clientId, "AUDITS_PER_DAY");
    log(`Audit done`, {
      callId,
      auditRunNo: audit.audit.auditRunNo,
      model: audit.model,
      scorePercent: audit.validated.scorePercent,
    });
  } catch (e) {
    const code = e instanceof LiveAuditError ? e.code : "UNKNOWN";
    const msg = e instanceof Error ? e.message : "Live audit failed.";

    // Retry transient failures (429, 500, timeout, network) automatically.
    if (isTransientError(code) && MAX_RETRIES > 0) {
      // Read current retry count from the DB.
      const callRow = await prisma.call.findUnique({
        where: { id: callId },
        select: { processingError: true },
      });
      const currentRetry = parseRetryCount(callRow?.processingError);
      if (currentRetry < MAX_RETRIES) {
        const nextRetry = currentRetry + 1;
        const backoff = retryBackoffMs(currentRetry);
        log(`Audit failed (transient) — scheduling retry ${nextRetry}/${MAX_RETRIES} in ${Math.round(backoff / 1000)}s`, {
          callId,
          code,
          msg,
        });
        await prisma.call.update({
          where: { id: callId },
          data: {
            processingStatus: "uploaded",
            processingError: `[retry:${nextRetry}] ${code}: ${msg}`,
            // Set processingStartedAt to a future time so claimBatch skips it
            // until the backoff period has elapsed.
            processingStartedAt: new Date(Date.now() + backoff),
          },
        });
        publishCallEvent(callId, {
          type: "status",
          status: "uploaded",
        });
        return;
      }
      // Exhausted retries — fall through to permanent failure.
      log(`Audit failed — retries exhausted (${MAX_RETRIES}/${MAX_RETRIES})`, { callId, code });
    }

    await failProcessingLock(callId, `AUDIT ${code}: ${msg}`);
    publishCallEvent(callId, { type: "failed", stage: "audit", code, message: msg });
    void publishWebhookEvent(clientId, "call.audit.failed", {
      callId,
      stage: "audit",
      code,
      message: msg,
    });
    log(`Audit failed`, { callId, code, msg });
  }
}

/** Extract retry count from processingError field like "[retry:2] ..." */
function parseRetryCount(error: string | null | undefined): number {
  if (!error) return 0;
  const match = error.match(/^\[retry:(\d+)\]/);
  return match ? Number(match[1]) : 0;
}

async function loop(): Promise<void> {
  log(`Queue worker started`, { pollMs: POLL_MS, concurrency: CONCURRENCY, maxRetries: MAX_RETRIES });
  await recoverStaleCalls();

  while (!shuttingDown) {
    // Calculate how many new jobs we can take.
    const slotsAvailable = CONCURRENCY - activeCount;
    if (slotsAvailable <= 0) {
      // All slots full — wait a bit for one to finish.
      await sleep(500);
      continue;
    }

    let jobs: { id: string; clientId: string }[] = [];
    try {
      jobs = await claimBatch(slotsAvailable);
    } catch (e) {
      logErr("Failed to claim jobs — sleeping before retry.", e);
      await sleep(POLL_MS);
      continue;
    }

    if (jobs.length === 0) {
      await sleep(POLL_MS);
      continue;
    }

    // Fire off each job concurrently. We track activeCount so the loop
    // knows not to over-claim.
    for (const job of jobs) {
      activeCount++;
      processCall(job.id, job.clientId)
        .catch((e) => {
          logErr(`Unexpected error processing call ${job.id}`, e);
          // Last-resort safety — mark the call failed so it doesn't sit half-locked.
          return failProcessingLock(
            job.id,
            e instanceof Error ? e.message : "Unhandled worker error.",
          ).catch((innerErr) => {
            logErr(`Also failed to mark call ${job.id} as failed`, innerErr);
          });
        })
        .finally(() => {
          activeCount--;
        });
    }
  }

  // Wait for in-flight jobs to finish before shutting down.
  if (activeCount > 0) {
    log(`Waiting for ${activeCount} in-flight job(s) to finish...`);
    while (activeCount > 0) {
      await sleep(500);
    }
  }

  log("Queue worker shutting down — disconnecting Prisma.");
  await prisma.$disconnect().catch(() => {});
}

function installSignalHandlers(): void {
  const handle = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`Received ${sig} — finishing ${activeCount} in-flight job(s) then exiting.`);
  };
  process.on("SIGINT", () => handle("SIGINT"));
  process.on("SIGTERM", () => handle("SIGTERM"));
}

installSignalHandlers();

loop().catch(async (err) => {
  logErr("Fatal worker error", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
