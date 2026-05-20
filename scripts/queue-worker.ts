// Background queue worker for call processing.
//
// Polls for calls left in processingStatus="uploaded" by the Excel import,
// runs local STT then live AI audit, and releases the processing lock.
//
// One call at a time. Started by PM2 (see ecosystem.config.js) alongside the
// web app, or directly via `npm run worker:queue` for development.
//
// Env:
//   QUEUE_WORKER_POLL_MS       default 5000  — sleep between empty polls
//   QUEUE_WORKER_RECOVER_STALE default true  — on startup, reset calls stuck
//                                              in transcribing/auditing past
//                                              the 30 min stale window back to
//                                              "uploaded" so they re-enter the
//                                              queue.

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runLocalSttForCall } from "../src/services/transcription";
import { runLiveAuditForCall, LiveAuditError } from "../src/services/audit";
import { SttError } from "../src/services/stt";
import {
  releaseProcessingLock,
  failProcessingLock,
} from "../src/lib/processing-lock";

const POLL_MS = (() => {
  const v = Number(process.env.QUEUE_WORKER_POLL_MS ?? "5000");
  return Number.isFinite(v) && v >= 500 ? v : 5000;
})();
const STALE_LOCK_MS = 30 * 60 * 1000;

let shuttingDown = false;

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
 * Atomically claim the oldest call in processingStatus="uploaded".
 * Uses a select-then-guarded-updateMany so a second worker (or a concurrent
 * manual action) cannot also claim it.
 */
async function claimNext(): Promise<{ id: string; clientId: string } | null> {
  const candidate = await prisma.call.findFirst({
    where: { processingStatus: "uploaded" },
    orderBy: { createdAt: "asc" },
    select: { id: true, clientId: true },
  });
  if (!candidate) return null;

  const claimed = await prisma.call.updateMany({
    where: { id: candidate.id, processingStatus: "uploaded" },
    data: {
      processingStatus: "transcribing",
      processingStartedAt: new Date(),
      processingError: null,
    },
  });
  if (claimed.count === 0) return null;
  return candidate;
}

async function processCall(callId: string, clientId: string): Promise<void> {
  log(`Processing call`, { callId });

  // Stage 1 — transcription. Lock is already at "transcribing" from claim.
  try {
    const stt = await runLocalSttForCall(callId, clientId);
    log(`Transcription done`, {
      callId,
      model: stt.winningModel,
      segments: stt.segmentCount,
      fallback: stt.usedFallback,
    });
  } catch (e) {
    const code = e instanceof SttError ? e.code : "UNKNOWN";
    const msg = e instanceof Error ? e.message : "Local STT failed.";
    await failProcessingLock(callId, `STT ${code}: ${msg}`);
    log(`Transcription failed`, { callId, code, msg });
    return;
  }

  // Stage 2 — audit. Move status to "auditing" so the UI reflects the stage.
  await prisma.call.update({
    where: { id: callId },
    data: { processingStatus: "auditing", processingStartedAt: new Date() },
  });

  try {
    const audit = await runLiveAuditForCall(callId, clientId);
    await releaseProcessingLock(callId);
    log(`Audit done`, {
      callId,
      auditRunNo: audit.audit.auditRunNo,
      model: audit.model,
      scorePercent: audit.validated.scorePercent,
    });
  } catch (e) {
    const code = e instanceof LiveAuditError ? e.code : "UNKNOWN";
    const msg = e instanceof Error ? e.message : "Live audit failed.";
    await failProcessingLock(callId, `AUDIT ${code}: ${msg}`);
    log(`Audit failed`, { callId, code, msg });
  }
}

async function loop(): Promise<void> {
  log(`Queue worker started`, { pollMs: POLL_MS });
  await recoverStaleCalls();

  while (!shuttingDown) {
    let job: { id: string; clientId: string } | null = null;
    try {
      job = await claimNext();
    } catch (e) {
      logErr("Failed to claim next job — sleeping before retry.", e);
      await sleep(POLL_MS);
      continue;
    }

    if (!job) {
      await sleep(POLL_MS);
      continue;
    }

    try {
      await processCall(job.id, job.clientId);
    } catch (e) {
      logErr(`Unexpected error processing call ${job.id}`, e);
      // Last-resort safety — mark the call failed so it doesn't sit half-locked.
      try {
        await failProcessingLock(
          job.id,
          e instanceof Error ? e.message : "Unhandled worker error.",
        );
      } catch (innerErr) {
        logErr(`Also failed to mark call ${job.id} as failed`, innerErr);
      }
    }
  }

  log("Queue worker shutting down — disconnecting Prisma.");
  await prisma.$disconnect().catch(() => {});
}

function installSignalHandlers(): void {
  const handle = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`Received ${sig} — finishing current call (if any) then exiting.`);
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
