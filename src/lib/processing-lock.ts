import "server-only";
import { prisma } from "@/lib/db";

export type ProcessingStatus =
  | "idle"
  | "transcribing"
  | "auditing"
  | "processing_demo"
  | "failed";

const STALE_LOCK_MS = 30 * 60 * 1000; // 30 minutes

export class ProcessingLockedError extends Error {
  code = "PROCESSING_LOCKED" as const;
  currentStatus: string;
  startedAt: Date | null;
  constructor(currentStatus: string, startedAt: Date | null) {
    super(
      `Call is already ${currentStatus}. Wait for the current step to complete, then retry.`,
    );
    this.currentStatus = currentStatus;
    this.startedAt = startedAt;
  }
}

/**
 * Atomically claim a processing lock on a call.
 *
 *  - If the call is `idle` / `failed` / `null` → set to the requested status and return.
 *  - If the call is in a "running" status but its `processingStartedAt` is older
 *    than STALE_LOCK_MS → forcibly take the lock (stale).
 *  - Otherwise throw `ProcessingLockedError`.
 *
 * The whole transition is done as a `updateMany` with a guard predicate so two
 * concurrent attempts can't both win.
 */
export async function acquireProcessingLock(
  callId: string,
  status: Exclude<ProcessingStatus, "idle" | "failed">,
): Promise<void> {
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MS);

  // Try the optimistic transition. `updateMany` returns the affected row count
  // so we know whether we actually took the lock.
  const claimed = await prisma.call.updateMany({
    where: {
      id: callId,
      OR: [
        { processingStatus: null },
        { processingStatus: "idle" },
        { processingStatus: "failed" },
        // stale lock — previous run never released within 30 min
        { processingStartedAt: { lt: staleCutoff } },
      ],
    },
    data: {
      processingStatus: status,
      processingStartedAt: new Date(),
      processingError: null,
    },
  });

  if (claimed.count === 0) {
    const current = await prisma.call.findUnique({
      where: { id: callId },
      select: { processingStatus: true, processingStartedAt: true },
    });
    throw new ProcessingLockedError(
      current?.processingStatus ?? "running",
      current?.processingStartedAt ?? null,
    );
  }
}

/** Release a successfully-completed lock (sets status back to "idle"). */
export async function releaseProcessingLock(callId: string): Promise<void> {
  await prisma.call.update({
    where: { id: callId },
    data: { processingStatus: "idle", processingStartedAt: null, processingError: null },
  });
}

/** Mark the call as failed (keeps the error message visible). */
export async function failProcessingLock(
  callId: string,
  error: string,
): Promise<void> {
  await prisma.call.update({
    where: { id: callId },
    data: {
      processingStatus: "failed",
      processingStartedAt: null,
      processingError: error.slice(0, 500),
    },
  });
}

/** True if the call is currently considered "processing" (not stale). */
export function isActivelyProcessing(
  status: string | null | undefined,
  startedAt: Date | null | undefined,
): boolean {
  if (!status) return false;
  if (status === "idle" || status === "failed") return false;
  if (!startedAt) return true;
  return Date.now() - startedAt.getTime() < STALE_LOCK_MS;
}
