import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { query } from "../procedure";
import { ApiError } from "../errors";

const CallListFiltersSchema = z.object({
  search: z.string().max(256).optional(),
  campaignId: z.string().optional(),
  teamId: z.string().optional(),
  agentId: z.string().optional(),
  sentiment: z.string().max(64).optional(),
  auditStatus: z.enum(["AUDITED", "PENDING", "IN_REVIEW"]).optional(),
  manualDisposition: z.string().max(64).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  take: z.coerce.number().int().positive().max(500).default(100),
  cursor: z.string().optional(),
});

export type CallListInput = z.infer<typeof CallListFiltersSchema>;

function buildWhere(clientId: string, filters: CallListInput): Prisma.CallWhereInput {
  const where: Prisma.CallWhereInput = { clientId };
  if (filters.campaignId) where.campaignId = filters.campaignId;
  if (filters.teamId) where.teamId = filters.teamId;
  if (filters.agentId) where.agentId = filters.agentId;
  if (filters.sentiment) {
    where.sentiment = { equals: filters.sentiment, mode: "insensitive" };
  }
  if (filters.manualDisposition) where.manualDisposition = filters.manualDisposition;
  if (filters.auditStatus === "AUDITED") where.aiScore = { not: null };
  else if (filters.auditStatus === "PENDING") where.aiScore = null;
  else if (filters.auditStatus === "IN_REVIEW") {
    where.manualReviews = {
      some: { status: { in: ["PENDING", "IN_PROGRESS"] } },
    };
  }
  if (filters.from || filters.to) {
    where.callStartedAt = {};
    if (filters.from) where.callStartedAt.gte = filters.from;
    if (filters.to) where.callStartedAt.lte = filters.to;
  }
  if (filters.search) {
    const q = filters.search.trim();
    where.OR = [
      { id: { contains: q, mode: "insensitive" } },
      { externalCallId: { contains: q, mode: "insensitive" } },
      { callerNumber: { contains: q } },
      { calleeNumber: { contains: q } },
      { customerName: { contains: q, mode: "insensitive" } },
      { agent: { name: { contains: q, mode: "insensitive" } } },
    ];
  }
  return where;
}

const CallListInclude = {
  agent: { select: { id: true, name: true } },
  campaign: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  client: { select: { id: true, name: true } },
  transcript: {
    select: { id: true, speakerLabelsCorrected: true, speakerCorrectedAt: true },
  },
  manualReviews: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: { id: true, status: true, scorePercent: true },
  },
} satisfies Prisma.CallInclude;

export const callsRouter = {
  list: query("calls.list", {
    input: CallListFiltersSchema,
    scope: "calls:read",
    async handler({ ctx, input }) {
      const rows = await prisma.call.findMany({
        where: buildWhere(ctx.actor.clientId, input),
        orderBy: [{ callStartedAt: "desc" }, { createdAt: "desc" }],
        take: input.take + 1, // peek for next cursor
        cursor: input.cursor ? { id: input.cursor } : undefined,
        skip: input.cursor ? 1 : 0,
        include: CallListInclude,
      });
      const hasMore = rows.length > input.take;
      const items = hasMore ? rows.slice(0, input.take) : rows;
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1].id : null,
      };
    },
  }),

  get: query("calls.get", {
    input: z.object({ id: z.string() }),
    scope: "calls:read",
    async handler({ ctx, input }) {
      const row = await prisma.call.findFirst({
        where: { id: input.id, clientId: ctx.actor.clientId },
        include: CallListInclude,
      });
      if (!row) throw new ApiError("NOT_FOUND", "Call not found.");
      return row;
    },
  }),

  uploadOptions: query("calls.uploadOptions", {
    input: z.object({}).default({}),
    async handler({ ctx }) {
      const [client, campaigns, teams, agents] = await Promise.all([
        prisma.client.findUnique({
          where: { id: ctx.actor.clientId },
          select: { id: true, name: true },
        }),
        prisma.campaign.findMany({
          where: { clientId: ctx.actor.clientId, isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.team.findMany({
          where: { clientId: ctx.actor.clientId },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        prisma.agent.findMany({
          where: { clientId: ctx.actor.clientId, isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, teamId: true },
        }),
      ]);
      return { client, campaigns, teams, agents };
    },
  }),
};
