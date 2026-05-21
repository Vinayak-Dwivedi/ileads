import "server-only";

import { appRouter, actorFromSession } from "@/server/api";
import { getSession } from "@/lib/auth";
import { newTraceId } from "@/lib/logger";
import { ApiError } from "@/server/api";

// Public types preserved for existing page/component imports. The actual data
// access has moved to src/server/api/routers/calls.ts. This file now exists
// only as a thin adapter that wraps a session-derived Context and calls the
// router so legacy callers keep working unchanged.

export interface CallListFilters {
  search?: string;
  campaignId?: string;
  teamId?: string;
  agentId?: string;
  sentiment?: string;
  auditStatus?: string;
  manualDisposition?: string;
  from?: Date;
  to?: Date;
}

async function sessionContext(clientId: string) {
  const session = await getSession();
  if (!session) {
    throw new ApiError("UNAUTHORIZED", "Not signed in.");
  }
  if (session.clientId !== clientId) {
    throw new ApiError("FORBIDDEN", "Session client does not match requested client.");
  }
  return {
    actor: actorFromSession(session),
    traceId: newTraceId(),
  };
}

export async function listCalls(
  clientId: string,
  filters: CallListFilters = {},
  take = 100,
) {
  const ctx = await sessionContext(clientId);
  // Zod schema in callsRouter narrows auditStatus to the supported set; any
  // other value throws INVALID_INPUT.
  const result = await appRouter.calls.list(ctx, {
    ...filters,
    auditStatus: filters.auditStatus as "AUDITED" | "PENDING" | "IN_REVIEW" | undefined,
    take,
  });
  return result.items;
}

export async function getCallUploadOptions(clientId: string) {
  const ctx = await sessionContext(clientId);
  return appRouter.calls.uploadOptions(ctx, {});
}

export type CallListItem = Awaited<ReturnType<typeof listCalls>>[number];
export type CallUploadOptions = Awaited<ReturnType<typeof getCallUploadOptions>>;
