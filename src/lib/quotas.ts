import "server-only";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { publishWebhookEvent } from "@/lib/webhooks";

export type QuotaKind = "AUDITS_PER_DAY" | "CALLS_PER_DAY" | "STT_MINUTES_PER_DAY";

export class QuotaExceededError extends Error {
  readonly code = "QUOTA_EXCEEDED" as const;
  readonly kind: QuotaKind;
  readonly limit: number;
  readonly currentCount: number;
  // Seconds until the daily bucket resets (UTC midnight).
  readonly retryAfterSeconds: number;
  constructor(kind: QuotaKind, currentCount: number, limit: number) {
    super(`Daily quota exceeded for ${kind}: ${currentCount}/${limit}.`);
    this.name = "QuotaExceededError";
    this.kind = kind;
    this.limit = limit;
    this.currentCount = currentCount;
    this.retryAfterSeconds = secondsUntilUtcMidnight();
  }
}

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  );
  return Math.max(1, Math.floor((nextMidnight - now.getTime()) / 1000));
}

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
  hardEnforced: boolean;
}

/**
 * Increment per-day usage for (clientId, kind). Behavior depends on the
 * matching ClientQuota row:
 *   - no row → always succeed, no limit, no log.
 *   - row.hardEnforce=false (soft) → log warning + fire quota.exceeded
 *     webhook on overage, request still succeeds.
 *   - row.hardEnforce=true → throw QuotaExceededError on overage. The
 *     caller must catch and translate to an HTTP 429.
 *
 * Pass `by` for batch/duration metering (e.g. STT minutes).
 */
export async function trackQuotaUsage(
  clientId: string,
  kind: QuotaKind,
  by = 1,
): Promise<TrackResult> {
  if (!Number.isFinite(by) || by <= 0) {
    return { newCount: 0, limit: null, exceeded: false, hardEnforced: false };
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
    return { newCount: 0, limit: null, exceeded: false, hardEnforced: false };
  }

  let limit: number | null = null;
  let hardEnforce = false;
  try {
    const quota = await prisma.clientQuota.findUnique({
      where: { clientId_kind: { clientId, kind } },
      select: { dailyLimit: true, isActive: true, hardEnforce: true },
    });
    if (quota?.isActive) {
      limit = quota.dailyLimit;
      hardEnforce = quota.hardEnforce;
    }
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
      hardEnforce,
    });
    void publishWebhookEvent(clientId, "quota.exceeded", {
      kind,
      day: day.toISOString().slice(0, 10),
      count: row.count,
      limit,
      hardEnforce,
    });
    if (hardEnforce && limit != null) {
      throw new QuotaExceededError(kind, row.count, limit);
    }
  }

  return { newCount: row.count, limit, exceeded, hardEnforced: hardEnforce };
}

/**
 * Pre-check a quota WITHOUT incrementing — use this on the entry path of
 * expensive operations (Excel import, batch re-audit) so we don't half-do
 * the work and then realise we're over the limit.
 *
 * Returns immediately if no quota row exists or the row is soft.
 * Throws QuotaExceededError if the row is hard-enforced and current usage
 * is already at or above limit.
 */
export async function assertQuotaAllows(
  clientId: string,
  kind: QuotaKind,
  by = 1,
): Promise<void> {
  const quota = await prisma.clientQuota.findUnique({
    where: { clientId_kind: { clientId, kind } },
    select: { dailyLimit: true, isActive: true, hardEnforce: true },
  });
  if (!quota?.isActive || !quota.hardEnforce) return;

  const day = dayKey();
  const usage = await prisma.quotaUsage.findUnique({
    where: { clientId_kind_day: { clientId, kind, day } },
    select: { count: true },
  });
  const current = usage?.count ?? 0;
  if (current + by > quota.dailyLimit) {
    throw new QuotaExceededError(kind, current + by, quota.dailyLimit);
  }
}
