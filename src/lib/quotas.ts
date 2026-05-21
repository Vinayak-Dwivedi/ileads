import "server-only";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { publishWebhookEvent } from "@/lib/webhooks";

export type QuotaKind = "AUDITS_PER_DAY" | "CALLS_PER_DAY" | "STT_MINUTES_PER_DAY";

/** UTC YYYY-MM-DD as a Date at 00:00 UTC. Used as the @db.Date column value. */
function dayKey(now = new Date()): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  return new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
}

export interface TrackResult {
  newCount: number;
  limit: number | null;
  exceeded: boolean;
}

/**
 * Increment per-day usage for (clientId, kind). Soft enforcement only — if
 * a quota row exists and the new count exceeds dailyLimit, we log a warning
 * and publish a `quota.exceeded` webhook event but DO NOT block the request.
 * Hard enforcement will be introduced in a follow-up once we baseline usage.
 *
 * `by` defaults to 1; pass a different value for batch or duration-based
 * metering (e.g. trackQuotaUsage(clientId, "STT_MINUTES_PER_DAY", minutes)).
 */
export async function trackQuotaUsage(
  clientId: string,
  kind: QuotaKind,
  by = 1,
): Promise<TrackResult> {
  if (!Number.isFinite(by) || by <= 0) {
    return { newCount: 0, limit: null, exceeded: false };
  }

  const day = dayKey();

  let row;
  try {
    row = await prisma.quotaUsage.upsert({
      where: { clientId_kind_day: { clientId, kind, day } },
      create: { clientId, kind, day, count: by },
      update: { count: { increment: by } },
      select: { count: true },
    });
  } catch (err) {
    logger.error("quota_usage_upsert_failed", {
      clientId,
      kind,
      err: err instanceof Error ? err.message : String(err),
    });
    return { newCount: 0, limit: null, exceeded: false };
  }

  let limit: number | null = null;
  try {
    const quota = await prisma.clientQuota.findUnique({
      where: { clientId_kind: { clientId, kind } },
      select: { dailyLimit: true, isActive: true },
    });
    if (quota?.isActive) limit = quota.dailyLimit;
  } catch (err) {
    logger.warn("quota_lookup_failed", {
      clientId,
      kind,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const exceeded = limit != null && row.count > limit;
  if (exceeded) {
    logger.warn("quota_exceeded", {
      clientId,
      kind,
      newCount: row.count,
      limit,
    });
    void publishWebhookEvent(clientId, "quota.exceeded", {
      kind,
      day: day.toISOString().slice(0, 10),
      count: row.count,
      limit,
    });
  }

  return { newCount: row.count, limit, exceeded };
}
