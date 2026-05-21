// BullMQ-backed worker for call processing. Runs two workers in-process —
// one for the transcribe queue and one for the audit queue. Horizontally
// scalable: launch N copies behind the same Redis and they cooperate.
//
// Usage:
//   REDIS_URL=redis://127.0.0.1:6379 npm run worker:bullmq
//
// Env:
//   QUEUE_CONCURRENCY  default 2 per queue
//   REDIS_URL          required; falls back to a no-op exit when missing.

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runLocalSttForCall } from "../src/services/transcription";
import { runLiveAuditForCall, LiveAuditError } from "../src/services/audit";
import { SttError } from "../src/services/stt";
import {
  releaseProcessingLock,
  failProcessingLock,
} from "../src/lib/processing-lock";
import {
  QUEUE_NAMES,
  _getConnectionForWorker,
  enqueueAudit,
  isQueueEnabled,
  type CallJobData,
} from "../src/lib/queue";
import { publishCallEvent } from "../src/lib/event-bus";

async function main() {
  if (!isQueueEnabled()) {
    console.error(
      "REDIS_URL is not set. Either set it to enable BullMQ, or run `npm run worker:queue` for the in-process polling worker.",
    );
    process.exit(2);
  }

  const concurrency = Number(process.env.QUEUE_CONCURRENCY ?? "2") || 2;
  const { Worker } = await import("bullmq");
  const conn = (await _getConnectionForWorker()) as never;

  // Stage 1 — transcription.
  const transcribeWorker = new Worker<CallJobData>(
    QUEUE_NAMES.transcribe,
    async (job) => {
      const { callId, clientId } = job.data;
      await prisma.call.update({
        where: { id: callId },
        data: { processingStatus: "transcribing", processingStartedAt: new Date() },
      });
      publishCallEvent(callId, { type: "status", status: "transcribing" });
      try {
        const stt = await runLocalSttForCall(callId, clientId);
        publishCallEvent(callId, {
          type: "transcribed",
          model: stt.winningModel,
          segments: stt.segmentCount,
          usedFallback: stt.usedFallback,
        });
        await enqueueAudit({ callId, clientId });
      } catch (e) {
        const code = e instanceof SttError ? e.code : "UNKNOWN";
        const msg = e instanceof Error ? e.message : "Local STT failed.";
        await failProcessingLock(callId, `STT ${code}: ${msg}`);
        publishCallEvent(callId, { type: "failed", stage: "stt", code, message: msg });
        throw e;
      }
    },
    { connection: conn, concurrency },
  );

  // Stage 2 — audit.
  const auditWorker = new Worker<CallJobData>(
    QUEUE_NAMES.audit,
    async (job) => {
      const { callId, clientId } = job.data;
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
      } catch (e) {
        const code = e instanceof LiveAuditError ? e.code : "UNKNOWN";
        const msg = e instanceof Error ? e.message : "Live audit failed.";
        await failProcessingLock(callId, `AUDIT ${code}: ${msg}`);
        publishCallEvent(callId, { type: "failed", stage: "audit", code, message: msg });
        throw e;
      }
    },
    { connection: conn, concurrency },
  );

  for (const [name, w] of [
    ["transcribe", transcribeWorker],
    ["audit", auditWorker],
  ] as const) {
    w.on("ready", () => console.log(`[bullmq] ${name} worker ready (concurrency=${concurrency})`));
    w.on("failed", (job, err) =>
      console.error(`[bullmq] ${name} job ${job?.id} failed: ${err.message}`),
    );
    w.on("error", (err) => console.error(`[bullmq] ${name} worker error:`, err));
  }

  const shutdown = async (sig: string) => {
    console.log(`[bullmq] received ${sig} — closing workers.`);
    await Promise.allSettled([transcribeWorker.close(), auditWorker.close()]);
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[bullmq] fatal:", err);
  process.exit(1);
});
