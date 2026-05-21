import "server-only";

import { appRouter, actorFromSession, ApiError } from "@/server/api";
import { getSession } from "@/lib/auth";
import { newTraceId } from "@/lib/logger";

// Public types preserved for existing dashboard page imports. Internally
// every function now delegates to src/server/api/routers/dashboard.ts so the
// dashboard endpoints (UI + /api/v1/dashboard/*) share one query path.

export interface DashboardFilters {
  campaignId?: string;
  teamId?: string;
  agentId?: string;
  from?: Date;
  to?: Date;
}

async function sessionContext(clientId: string) {
  const session = await getSession();
  if (!session) throw new ApiError("UNAUTHORIZED", "Not signed in.");
  if (session.clientId !== clientId) {
    throw new ApiError("FORBIDDEN", "Session client does not match.");
  }
  return { actor: actorFromSession(session), traceId: newTraceId() };
}

export type DashboardKpis = Awaited<ReturnType<typeof getDashboardKpis>>;
export type SentimentBreakdown = Awaited<ReturnType<typeof getSentimentBreakdown>>;
export type ScoreboardRow = Awaited<ReturnType<typeof getAgentScoreboard>>[number];
export type DailyQualityPoint = Awaited<ReturnType<typeof getDailyQualityScore>>[number];

export async function getDashboardKpis(clientId: string, filters: DashboardFilters) {
  const ctx = await sessionContext(clientId);
  return appRouter.dashboard.kpis(ctx, filters as never);
}

export async function getSentimentBreakdown(clientId: string, filters: DashboardFilters) {
  const ctx = await sessionContext(clientId);
  return appRouter.dashboard.sentimentBreakdown(ctx, filters as never);
}

export async function getAgentScoreboard(
  clientId: string,
  filters: DashboardFilters,
  limit = 10,
) {
  const ctx = await sessionContext(clientId);
  return appRouter.dashboard.agentScoreboard(ctx, { ...filters, limit } as never);
}

export async function getDashboardInsights(
  clientId: string,
  filters: DashboardFilters,
  take = 6,
) {
  const ctx = await sessionContext(clientId);
  return appRouter.dashboard.insights(ctx, { ...filters, take } as never);
}

export async function getDailyQualityScore(
  clientId: string,
  filters: DashboardFilters,
  days = 14,
) {
  const ctx = await sessionContext(clientId);
  return appRouter.dashboard.dailyQuality(ctx, { ...filters, days } as never);
}

export async function getFilterOptions(clientId: string) {
  const ctx = await sessionContext(clientId);
  return appRouter.dashboard.filterOptions(ctx, {});
}
