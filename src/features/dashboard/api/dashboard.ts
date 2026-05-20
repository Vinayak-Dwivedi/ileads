import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

export interface DashboardFilters {
  campaignId?: string;
  teamId?: string;
  agentId?: string;
  from?: Date;
  to?: Date;
}

export interface DashboardKpis {
  totalCalls: number;
  aiAudited: number;
  manualReviewed: number;
  averageQualityPercent: number | null;
  firstResponseSeconds: number | null;
  averageHandleSeconds: number | null;
}

function buildCallWhere(clientId: string, f: DashboardFilters): Prisma.CallWhereInput {
  const where: Prisma.CallWhereInput = { clientId };
  if (f.campaignId) where.campaignId = f.campaignId;
  if (f.teamId) where.teamId = f.teamId;
  if (f.agentId) where.agentId = f.agentId;
  if (f.from || f.to) {
    where.callStartedAt = {};
    if (f.from) where.callStartedAt.gte = f.from;
    if (f.to) where.callStartedAt.lte = f.to;
  }
  return where;
}

function buildComplianceWhere(clientId: string, f: DashboardFilters): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`c."client_id" = ${clientId}`,
    Prisma.sql`c."agent_id" IS NOT NULL`,
    Prisma.sql`aa."is_latest" = true`,
    Prisma.sql`aa."status" = 'COMPLETED'`,
    Prisma.sql`cp."parameter_category" ILIKE 'Compliance%'`,
  ];

  if (f.campaignId) conditions.push(Prisma.sql`c."campaign_id" = ${f.campaignId}`);
  if (f.teamId) conditions.push(Prisma.sql`c."team_id" = ${f.teamId}`);
  if (f.agentId) conditions.push(Prisma.sql`c."agent_id" = ${f.agentId}`);
  if (f.from) conditions.push(Prisma.sql`c."call_started_at" >= ${f.from}`);
  if (f.to) conditions.push(Prisma.sql`c."call_started_at" <= ${f.to}`);

  return Prisma.join(conditions, " AND ");
}

export async function getDashboardKpis(
  clientId: string,
  filters: DashboardFilters,
): Promise<DashboardKpis> {
  const where = buildCallWhere(clientId, filters);

  const [totalCalls, aiAudited, manualReviewed, aggregate] = await Promise.all([
    prisma.call.count({ where }),
    prisma.call.count({ where: { ...where, aiScore: { not: null } } }),
    prisma.manualReview.count({ where: { call: where } }),
    prisma.call.aggregate({
      where,
      _avg: {
        finalScore: true,
        aiScore: true,
        firstResponseSeconds: true,
        averageHandleSeconds: true,
        durationSeconds: true,
      },
    }),
  ]);

  const avgQuality = aggregate._avg.finalScore ?? aggregate._avg.aiScore ?? null;
  const aht = aggregate._avg.averageHandleSeconds ?? aggregate._avg.durationSeconds ?? null;
  return {
    totalCalls,
    aiAudited,
    manualReviewed,
    averageQualityPercent: avgQuality,
    firstResponseSeconds: aggregate._avg.firstResponseSeconds,
    averageHandleSeconds: aht,
  };
}

export interface SentimentBreakdown {
  positive: number;
  neutral: number;
  negative: number;
  total: number;
}

export async function getSentimentBreakdown(
  clientId: string,
  filters: DashboardFilters,
): Promise<SentimentBreakdown> {
  const where = buildCallWhere(clientId, filters);
  const rows = await prisma.call.groupBy({
    by: ["sentiment"],
    where: { ...where, sentiment: { not: null } },
    _count: { _all: true },
  });
  let positive = 0;
  let neutral = 0;
  let negative = 0;
  for (const r of rows) {
    const v = (r.sentiment ?? "").toUpperCase();
    if (v === "POSITIVE") positive = r._count._all;
    else if (v === "NEGATIVE") negative = r._count._all;
    else if (v === "NEUTRAL") neutral = r._count._all;
  }
  return { positive, neutral, negative, total: positive + neutral + negative };
}

export interface ScoreboardRow {
  rank: number;
  agentId: string;
  agentName: string;
  employeeCode: string | null;
  campaignName: string | null;
  qaScorePercent: number | null;
  callCount: number;
  ahtSeconds: number | null;
  compliancePercent: number | null;
}

export async function getAgentScoreboard(
  clientId: string,
  filters: DashboardFilters,
  limit = 10,
): Promise<ScoreboardRow[]> {
  const where = buildCallWhere(clientId, filters);
  const grouped = await prisma.call.groupBy({
    by: ["agentId"],
    where: { ...where, agentId: { not: null } },
    _count: { _all: true },
    _avg: { finalScore: true, aiScore: true, durationSeconds: true, averageHandleSeconds: true },
  });

  const agentIds = grouped.map((g) => g.agentId).filter((x): x is string => !!x);
  if (agentIds.length === 0) return [];

  const agents = await prisma.agent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, name: true, employeeCode: true },
  });
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  // Top campaign per agent for display
  const campaignByAgent = new Map<string, string>();
  for (const aid of agentIds) {
    const campaign = await prisma.call.groupBy({
      by: ["campaignId"],
      where: { ...where, agentId: aid, campaignId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { campaignId: "desc" } },
      take: 1,
    });
    if (campaign[0]?.campaignId) {
      const c = await prisma.campaign.findUnique({
        where: { id: campaign[0].campaignId },
        select: { name: true },
      });
      if (c) campaignByAgent.set(aid, c.name);
    }
  }

  // Compliance %: share of compliance-category parameter scores that passed
  const compliance = await prisma.$queryRaw<
    Array<{ agentId: string; pass_rate: number | null }>
  >(Prisma.sql`
    SELECT c."agent_id" AS "agentId",
           AVG(CASE WHEN aps."is_passed" THEN 1.0 ELSE 0 END) AS "pass_rate"
    FROM "calls" c
    JOIN "ai_audits" aa ON aa."call_id" = c."id"
    JOIN "ai_parameter_scores" aps ON aps."ai_audit_id" = aa."id"
    JOIN "client_parameters" cp ON cp."id" = aps."parameter_id"
    WHERE ${buildComplianceWhere(clientId, filters)}
    GROUP BY c."agent_id"
  `);
  const complianceByAgent = new Map(compliance.map((c) => [c.agentId, c.pass_rate]));

  const rows: ScoreboardRow[] = grouped
    .filter((g) => g.agentId && agentMap.has(g.agentId))
    .map((g) => {
      const ag = agentMap.get(g.agentId!)!;
      return {
        rank: 0,
        agentId: ag.id,
        agentName: ag.name,
        employeeCode: ag.employeeCode,
        campaignName: campaignByAgent.get(ag.id) ?? null,
        qaScorePercent: g._avg.finalScore ?? g._avg.aiScore,
        callCount: g._count._all,
        ahtSeconds: g._avg.averageHandleSeconds ?? g._avg.durationSeconds,
        compliancePercent:
          complianceByAgent.get(ag.id) != null
            ? Number(complianceByAgent.get(ag.id)) * 100
            : null,
      };
    })
    .sort((a, b) => (b.qaScorePercent ?? -1) - (a.qaScorePercent ?? -1))
    .slice(0, limit)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return rows;
}

export async function getDashboardInsights(clientId: string, filters: DashboardFilters, take = 6) {
  const where = buildCallWhere(clientId, filters);
  return prisma.aiInsight.findMany({
    where: { call: where },
    orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    take,
    select: { id: true, insightType: true, severity: true, title: true, body: true },
  });
}

export interface DailyQualityPoint {
  date: string; // YYYY-MM-DD
  averagePercent: number; // 0-100
  auditedCalls: number;
}

/**
 * Group completed (latest) AI audits by day and return average score%
 * with the number of audited calls per day. Uses the latest audit per call.
 * Returns the last `days` consecutive dates (so the chart has a continuous axis),
 * filling days with no audits as null/0.
 */
export async function getDailyQualityScore(
  clientId: string,
  filters: DashboardFilters,
  days = 14,
): Promise<DailyQualityPoint[]> {
  const where = buildCallWhere(clientId, filters);
  // Only audits flagged isLatest and with a score.
  const audits = await prisma.aiAudit.findMany({
    where: {
      isLatest: true,
      status: "COMPLETED",
      scorePercent: { not: null },
      call: where,
    },
    select: { scorePercent: true, createdAt: true, callId: true, call: { select: { callStartedAt: true } } },
  });

  const buckets = new Map<string, { sum: number; count: number }>();
  for (const a of audits) {
    if (a.scorePercent == null) continue;
    // Prefer the call's start date if present; fall back to audit createdAt.
    const ref = a.call.callStartedAt ?? a.createdAt;
    const y = ref.getFullYear().toString().padStart(4, "0");
    const m = (ref.getMonth() + 1).toString().padStart(2, "0");
    const d = ref.getDate().toString().padStart(2, "0");
    const key = `${y}-${m}-${d}`;
    const b = buckets.get(key) ?? { sum: 0, count: 0 };
    b.sum += a.scorePercent;
    b.count += 1;
    buckets.set(key, b);
  }

  // Build a continuous list of the last `days` days ending today.
  const out: DailyQualityPoint[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const y = d.getFullYear().toString().padStart(4, "0");
    const m = (d.getMonth() + 1).toString().padStart(2, "0");
    const dd = d.getDate().toString().padStart(2, "0");
    const key = `${y}-${m}-${dd}`;
    const b = buckets.get(key);
    out.push({
      date: key,
      averagePercent: b && b.count > 0 ? b.sum / b.count : 0,
      auditedCalls: b?.count ?? 0,
    });
  }
  return out;
}

export async function getFilterOptions(clientId: string) {
  const [campaigns, teams, agents] = await Promise.all([
    prisma.campaign.findMany({
      where: { clientId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.team.findMany({
      where: { clientId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.agent.findMany({
      where: { clientId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, teamId: true },
    }),
  ]);
  return { campaigns, teams, agents };
}
