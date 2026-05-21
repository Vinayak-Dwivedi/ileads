import "server-only";
import { createHmac } from "node:crypto";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { generateWebhookSecret } from "@/lib/credentials";

// Re-exported so legacy callers (scripts/create-webhook.ts, webhooksRouter)
// keep working unchanged.
export { generateWebhookSecret };

// Canonical event taxonomy. Add new strings here so consumers can subscribe
// to them by name. Keep names dot-separated and stable — they're part of the
// public API contract.
export const WEBHOOK_EVENTS = [
  "call.imported",
  "call.transcript.ready",
  "call.audit.completed",
  "call.audit.failed",
  "quota.exceeded",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookDeliveryJob {
  webhookId: string;
  eventType: WebhookEvent;
  payload: Record<string, unknown>;
  // Pre-generated UUID so retries dedupe deliveries on the consumer side.
  deliveryId: string;
}

/**
 * Sign a serialised payload with the webhook secret. Returns the value that
 * goes into the X-QMS-Signature header: `sha256=<hex>`. The deliveryId is
 * mixed in so the same payload sent to two webhooks gets distinct signatures.
 */
export function signWebhookPayload(opts: {
  secret: string;
  deliveryId: string;
  timestamp: number;
  body: string;
}): string {
  const base = `${opts.deliveryId}.${opts.timestamp}.${opts.body}`;
  const sig = createHmac("sha256", opts.secret).update(base).digest("hex");
  return `sha256=${sig}`;
}

/**
 * Publish an event to all matching active webhooks for a client. Looks up
 * subscribers, creates a PENDING WebhookDelivery row per match, and enqueues
 * a delivery job to the qms.webhook BullMQ queue.
 *
 * No-op when no webhooks are configured. If BullMQ/Redis is not running,
 * the PENDING rows are still written; an operator can replay them later.
 */
export async function publishWebhookEvent(
  clientId: string,
  eventType: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  let webhooks;
  try {
    webhooks = await prisma.webhook.findMany({
      where: { clientId, isActive: true },
      select: { id: true, events: true },
    });
  } catch (err) {
    logger.error("webhook_lookup_failed", {
      clientId,
      eventType,
      err: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const matching = webhooks.filter((w) => {
    const subscribed = Array.isArray(w.events) ? (w.events as string[]) : [];
    return subscribed.includes(eventType) || subscribed.includes("*");
  });
  if (matching.length === 0) return;

  for (const w of matching) {
    let deliveryId: string;
    try {
      const delivery = await prisma.webhookDelivery.create({
        data: {
          webhookId: w.id,
          eventType,
          payload: payload as object,
          status: "PENDING",
        },
        select: { id: true },
      });
      deliveryId = delivery.id;
    } catch (err) {
      logger.error("webhook_delivery_row_failed", {
        webhookId: w.id,
        eventType,
        err: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // Enqueue to BullMQ. If Redis isn't configured, queue.ts no-ops and the
    // PENDING row stays for manual replay.
    try {
      const { enqueueWebhookDelivery } = await import("@/lib/queue");
      await enqueueWebhookDelivery({
        webhookId: w.id,
        eventType,
        payload,
        deliveryId,
      });
    } catch (err) {
      logger.error("webhook_enqueue_failed", {
        webhookId: w.id,
        deliveryId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
