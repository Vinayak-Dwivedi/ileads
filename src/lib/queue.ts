import "server-only";
import { logger } from "@/lib/logger";

// BullMQ-backed queues for call processing. Activates only when REDIS_URL is
// set in the environment; otherwise enqueue() is a no-op and the legacy
// polling worker (scripts/queue-worker.ts) handles processing by reading
// processingStatus="uploaded" rows directly from Postgres.
//
// This file imports bullmq/ioredis lazily so a dev install without Redis
// doesn't pay any cost.

export const QUEUE_NAMES = {
  transcribe: "qms.transcribe",
  audit: "qms.audit",
  webhook: "qms.webhook",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export function isQueueEnabled(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

let connectionPromise: Promise<unknown> | null = null;
async function getConnection() {
  if (!isQueueEnabled()) return null;
  if (!connectionPromise) {
    connectionPromise = (async () => {
      const { default: IORedis } = await import("ioredis");
      // BullMQ requires maxRetriesPerRequest=null on the connection.
      const conn = new IORedis(process.env.REDIS_URL!, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });
      conn.on("error", (err) =>
        logger.error("redis_connection_error", { err: err.message }),
      );
      return conn;
    })();
  }
  return connectionPromise;
}

interface Queues {
  transcribe: import("bullmq").Queue;
  audit: import("bullmq").Queue;
  webhook: import("bullmq").Queue;
}
let queuesPromise: Promise<Queues | null> | null = null;
async function getQueues(): Promise<Queues | null> {
  if (!isQueueEnabled()) return null;
  if (!queuesPromise) {
    queuesPromise = (async () => {
      const conn = await getConnection();
      if (!conn) return null;
      const { Queue } = await import("bullmq");
      return {
        transcribe: new Queue(QUEUE_NAMES.transcribe, {
          connection: conn as never,
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: "exponential", delay: 5_000 },
            removeOnComplete: { count: 1000, age: 24 * 3600 },
            removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
          },
        }),
        audit: new Queue(QUEUE_NAMES.audit, {
          connection: conn as never,
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: "exponential", delay: 5_000 },
            removeOnComplete: { count: 1000, age: 24 * 3600 },
            removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
          },
        }),
        webhook: new Queue(QUEUE_NAMES.webhook, {
          connection: conn as never,
          defaultJobOptions: {
            // 8 attempts over ~24h with exponential backoff — Stripe-style.
            attempts: 8,
            backoff: { type: "exponential", delay: 30_000 },
            removeOnComplete: { count: 5000, age: 7 * 24 * 3600 },
            removeOnFail: { count: 10000, age: 30 * 24 * 3600 },
          },
        }),
      };
    })();
  }
  return queuesPromise;
}

export interface CallJobData {
  callId: string;
  clientId: string;
}

/**
 * Enqueue a call for transcription. Returns true if the job was queued,
 * false if Redis isn't configured (legacy polling worker will pick it up
 * from processingStatus="uploaded" instead).
 */
export async function enqueueCallProcessing(data: CallJobData): Promise<boolean> {
  if (!isQueueEnabled()) return false;
  const queues = await getQueues();
  if (!queues) return false;
  try {
    await queues.transcribe.add("stt", data, {
      // Idempotency: a duplicate enqueue for the same call replaces the prior
      // job rather than running twice.
      jobId: `transcribe:${data.callId}`,
    });
    logger.info("queue_enqueued", { queue: QUEUE_NAMES.transcribe, callId: data.callId });
    return true;
  } catch (err) {
    logger.error("queue_enqueue_failed", {
      callId: data.callId,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Stage-2 enqueue called by the transcribe worker after STT completes. */
export async function enqueueAudit(data: CallJobData): Promise<boolean> {
  if (!isQueueEnabled()) return false;
  const queues = await getQueues();
  if (!queues) return false;
  await queues.audit.add("audit", data, { jobId: `audit:${data.callId}` });
  return true;
}

export interface WebhookDeliveryJobData {
  webhookId: string;
  eventType: string;
  payload: Record<string, unknown>;
  deliveryId: string;
}

/** Enqueue a webhook delivery. Returns false when Redis isn't configured. */
export async function enqueueWebhookDelivery(
  data: WebhookDeliveryJobData,
): Promise<boolean> {
  if (!isQueueEnabled()) return false;
  const queues = await getQueues();
  if (!queues) return false;
  await queues.webhook.add("deliver", data, {
    // Idempotent at the (webhookId, deliveryId) level — same delivery row
    // can't be enqueued twice.
    jobId: `webhook:${data.deliveryId}`,
  });
  return true;
}

/** Used by the worker to access raw queues for advanced ops. */
export async function _getQueuesForWorker(): Promise<Queues | null> {
  return getQueues();
}
export async function _getConnectionForWorker(): Promise<unknown> {
  return getConnection();
}
