import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prismaRead as prisma } from "@/lib/db";
import { query } from "../procedure";

const FiltersSchema = z.object({
  campaignId: z.string().optional(),
  teamId: z.string().optional(),
  agentId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

type Filters = z.infer<typeof FiltersSchema>;

function buildCallWhere(clientId: string, f: Filters): Prisma.CallWhereInput {
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

function buildComplianceWhere(clientId: string, f: Filters): Prisma.Sql {
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

export const dashboardRouter = {
  kpis: query("dashboard.kpis", {
    input: FiltersSchema,
    scope: "dashboard:read",
    async handler({ ctx, input }) {
      const where = buildCallWhere(ctx.actor.clientId, input);
      const [totalCalls, aiAudited, manualReviewed, aggregate] = await Promise.all([
        prisma.call.count({ where }),
        prisma.call.count({ where: { ...where, aiScore: { not: null } } }),
        prisma.manualReview.count({ where: { call: where } }),
        prisma.call.aggregate({
          where,
          _avg: { finalScore: true, aiScore: true, manualScore: true },
        }),
      ]);
      const aiAuditScore = aggregate._avg.aiScore ?? null;
      const manualAuditScore = aggregate._avg.manualScore ?? null;
      const averageAuditScore =
        aiAuditScore != null && manualAuditScore != null
          ? (aiAuditScore + manualAuditScore) / 2
          : null;
      return {
        totalCalls,
        aiAudited,
        manualReviewed,
        averageQualityPercent: aggregate._avg.finalScore ?? aggregate._avg.aiScore ?? null,
        aiAuditScorePercent: aiAuditScore,
        manualAuditScorePercent: manualAuditScore,
        averageAuditScorePercent: averageAuditScore,
      };
    },
  }),

  sentimentBreakdown: query("dashboard.sentimentBreakdown", {
    input: FiltersSchema,
    scope: "dashboard:read",
    async handler({ ctx, input }) {
      const where = buildCallWhere(ctx.actor.clientId, input);
      const rows = await prisma.call.groupBy({
        by: ["sentiment"],
        where: { ...where, sentiment: { not: null } },
        _count: { _all: true },
      });
      let positive = 0,
        neutral = 0,
        negative = 0;
      for (const r of rows) {
        const v = (r.sentiment ?? "").toUpperCase();
        if (v === "POSITIVE") positive = r._count._all;
        else if (v === "NEGATIVE") negative = r._count._all;
        else if (v === "NEUTRAL") neutral = r._count._all;
      }
      return { positive, neutral, negative, total: positive + neutral + negative };
    },
  }),

  agentScoreboard: query("dashboard.agentScoreboard", {
    input: FiltersSchema.extend({ limit: z.coerce.number().int().positive().max(50).default(10) }),
    scope: "dashboard:read",
    async handler({ ctx, input }) {
      const where = buildCallWhere(ctx.actor.clientId, input);
      const grouped = await prisma.call.groupBy({
        by: ["agentId"],
        where: { ...where, agentId: { not: null } },
        _count: { _all: true },
        _avg: {
          finalScore: true,
          aiScore: true,
          durationSeconds: true,
          averageHandleSeconds: true,
        },
      });
      const agentIds = grouped.map((g) => g.agentId).filter((x): x is string => !!x);
      if (agentIds.length === 0) return [];

      const agents = await prisma.agent.findMany({
        where: { id: { in: agentIds } },
        select: { id: true, name: true, employeeCode: true },
      });
      const agentMap = new Map(agents.map((a) => [a.id, a]));

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

      const compliance = await prisma.$queryRaw<
        Array<{ agentId: string; pass_rate: number | null }>
      >(Prisma.sql`
        SELECT c."agent_id" AS "agentId",
               AVG(CASE WHEN aps."is_passed" THEN 1.0 ELSE 0 END) AS "pass_rate"
        FROM "calls" c
        JOIN "ai_audits" aa ON aa."call_id" = c."id"
        JOIN "ai_parameter_scores" aps ON aps."ai_audit_id" = aa."id"
        JOIN "client_parameters" cp ON cp."id" = aps."parameter_id"
        WHERE ${buildComplianceWhere(ctx.actor.clientId, input)}
        GROUP BY c."agent_id"
      `);
      const complianceByAgent = new Map(compliance.map((c) => [c.agentId, c.pass_rate]));

      return grouped
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
        .slice(0, input.limit)
        .map((r, i) => ({ ...r, rank: i + 1 }));
    },
  }),

  insights: query("dashboard.insights", {
    input: FiltersSchema.extend({ take: z.coerce.number().int().positive().max(50).default(6) }),
    scope: "dashboard:read",
    async handler({ ctx, input }) {
      const where = buildCallWhere(ctx.actor.clientId, input);
      return prisma.aiInsight.findMany({
        where: { call: where },
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        take: input.take,
        select: { id: true, insightType: true, severity: true, title: true, body: true },
      });
    },
  }),

  dailyQuality: query("dashboard.dailyQuality", {
    input: FiltersSchema.extend({
      days: z.coerce.number().int().positive().max(180).default(14),
    }),
    scope: "dashboard:read",
    async handler({ ctx, input }) {
      const where = buildCallWhere(ctx.actor.clientId, input);
      const audits = await prisma.aiAudit.findMany({
        where: {
          isLatest: true,
          status: "COMPLETED",
          scorePercent: { not: null },
          call: where,
        },
        select: {
          scorePercent: true,
          createdAt: true,
          callId: true,
          call: { select: { callStartedAt: true } },
        },
      });

      const buckets = new Map<string, { sum: number; count: number }>();
      for (const a of audits) {
        if (a.scorePercent == null) continue;
        const ref = a.call.callStartedAt ?? a.createdAt;
        const key = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}-${String(ref.getDate()).padStart(2, "0")}`;
        const b = buckets.get(key) ?? { sum: 0, count: 0 };
        b.sum += a.scorePercent;
        b.count += 1;
        buckets.set(key, b);
      }

      const out: Array<{ date: string; averagePercent: number; auditedCalls: number }> = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      for (let i = input.days - 1; i >= 0; i -= 1) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const b = buckets.get(key);
        out.push({
          date: key,
          averagePercent: b && b.count > 0 ? b.sum / b.count : 0,
          auditedCalls: b?.count ?? 0,
        });
      }
      return out;
    },
  }),

  filterOptions: query("dashboard.filterOptions", {
    input: z.object({}).default({}),
    scope: "dashboard:read",
    async handler({ ctx }) {
      const [campaigns, teams, agents] = await Promise.all([
        prisma.campaign.findMany({
          where: { clientId: ctx.actor.clientId },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.team.findMany({
          where: { clientId: ctx.actor.clientId },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.agent.findMany({
          where: { clientId: ctx.actor.clientId },
          orderBy: { name: "asc" },
          select: { id: true, name: true, teamId: true },
        }),
      ]);
      return { campaigns, teams, agents };
    },
  }),
};
