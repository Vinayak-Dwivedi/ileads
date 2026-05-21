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
  type WebhookDeliveryJobData,
} from "../src/lib/queue";
import { publishCallEvent } from "../src/lib/event-bus";
import { publishWebhookEvent, signWebhookPayload } from "../src/lib/webhooks";
import { trackQuotaUsage } from "../src/lib/quotas";

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
        void publishWebhookEvent(clientId, "call.transcript.ready", {
          callId,
          model: stt.winningModel,
          segments: stt.segmentCount,
          usedFallback: stt.usedFallback,
        });
        void prisma.call
          .findUnique({ where: { id: callId }, select: { durationSeconds: true } })
          .then((c) => {
            const minutes = c?.durationSeconds
              ? Math.max(1, Math.ceil(c.durationSeconds / 60))
              : 1;
            return trackQuotaUsage(clientId, "STT_MINUTES_PER_DAY", minutes);
          })
          .catch(() => {});
        await enqueueAudit({ callId, clientId });
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
        void publishWebhookEvent(clientId, "call.audit.completed", {
          callId,
          auditRunNo: audit.audit.auditRunNo,
          model: audit.model,
          scorePercent: audit.validated.scorePercent,
        });
        void trackQuotaUsage(clientId, "AUDITS_PER_DAY");
      } catch (e) {
        const code = e instanceof LiveAuditError ? e.code : "UNKNOWN";
        const msg = e instanceof Error ? e.message : "Live audit failed.";
        await failProcessingLock(callId, `AUDIT ${code}: ${msg}`);
        publishCallEvent(callId, { type: "failed", stage: "audit", code, message: msg });
        void publishWebhookEvent(clientId, "call.audit.failed", {
          callId,
          stage: "audit",
          code,
          message: msg,
        });
        throw e;
      }
    },
    { connection: conn, concurrency },
  );

  // Stage 3 — webhook delivery.
  const webhookWorker = new Worker<WebhookDeliveryJobData>(
    QUEUE_NAMES.webhook,
    async (job) => {
      const { webhookId, eventType, payload, deliveryId } = job.data;
      const webhook = await prisma.webhook.findFirst({
        where: { id: webhookId, isActive: true },
        select: { id: true, url: true, secret: true },
      });
      if (!webhook) {
        // Subscription was deleted/deactivated between enqueue and delivery —
        // mark the row failed and don't retry.
        await prisma.webhookDelivery
          .update({
            where: { id: deliveryId },
            data: { status: "FAILED", error: "webhook not found or inactive" },
          })
          .catch(() => {});
        return;
      }

      const body = JSON.stringify({
        id: deliveryId,
        type: eventType,
        createdAt: new Date().toISOString(),
        data: payload,
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = signWebhookPayload({
        secret: webhook.secret,
        deliveryId,
        timestamp,
        body,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      let res: Response | null = null;
      let error: string | null = null;
      let responseBody = "";
      try {
        res = await fetch(webhook.url, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            "user-agent": "qms-webhook/1.0",
            "x-qms-event": eventType,
            "x-qms-delivery-id": deliveryId,
            "x-qms-timestamp": String(timestamp),
            "x-qms-signature": signature,
          },
          body,
        });
        responseBody = await res
          .text()
          .then((t) => t.slice(0, 1024))
          .catch(() => "");
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        clearTimeout(timer);
      }

      const ok = !!res && res.status >= 200 && res.status < 300;

      await prisma.webhookDelivery
        .update({
          where: { id: deliveryId },
          data: {
            attempt: job.attemptsMade + 1,
            status: ok ? "SUCCESS" : "FAILED",
            responseStatus: res?.status ?? null,
            responseBodyExcerpt: responseBody || null,
            error,
            deliveredAt: ok ? new Date() : null,
          },
        })
        .catch(() => {});

      if (!ok) {
        // Throwing surfaces the failure to BullMQ so it backs off + retries
        // up to the queue's `attempts` setting (8 by default).
        throw new Error(
          error ?? `Webhook responded with HTTP ${res?.status ?? "unknown"}`,
        );
      }
    },
    { connection: conn, concurrency: Math.max(concurrency, 4) },
  );

  for (const [name, w] of [
    ["transcribe", transcribeWorker],
    ["audit", auditWorker],
    ["webhook", webhookWorker],
  ] as const) {
    w.on("ready", () => console.log(`[bullmq] ${name} worker ready (concurrency=${concurrency})`));
    w.on("failed", (job, err) =>
      console.error(`[bullmq] ${name} job ${job?.id} failed: ${err.message}`),
    );
    w.on("error", (err) => console.error(`[bullmq] ${name} worker error:`, err));
  }

  const shutdown = async (sig: string) => {
    console.log(`[bullmq] received ${sig} — closing workers.`);
    await Promise.allSettled([
      transcribeWorker.close(),
      auditWorker.close(),
      webhookWorker.close(),
    ]);
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
