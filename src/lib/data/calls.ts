import "server-only";
import { prisma } from "@/lib/db";
import { Prisma, type CallStatus } from "@prisma/client";

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

function buildWhere(clientId: string, f: CallListFilters): Prisma.CallWhereInput {
  const where: Prisma.CallWhereInput = { clientId };
  if (f.campaignId) where.campaignId = f.campaignId;
  if (f.teamId) where.teamId = f.teamId;
  if (f.agentId) where.agentId = f.agentId;
  if (f.sentiment) {
    where.sentiment = { equals: f.sentiment, mode: "insensitive" };
  }
  if (f.manualDisposition) {
    where.manualDisposition = f.manualDisposition;
  }
  if (f.auditStatus) {
    const v = f.auditStatus.toUpperCase();
    if (v === "AUDITED") where.aiScore = { not: null };
    else if (v === "PENDING") where.aiScore = null;
    else if (v === "IN_REVIEW") {
      where.manualReviews = { some: { status: { in: ["PENDING", "IN_PROGRESS"] } } };
    }
  }
  if (f.from || f.to) {
    where.callStartedAt = {};
    if (f.from) where.callStartedAt.gte = f.from;
    if (f.to) where.callStartedAt.lte = f.to;
  }
  if (f.search) {
    const q = f.search.trim();
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

export async function listCalls(clientId: string, filters: CallListFilters = {}, take = 100) {
  return prisma.call.findMany({
    where: buildWhere(clientId, filters),
    orderBy: [{ callStartedAt: "desc" }, { createdAt: "desc" }],
    take,
    include: {
      agent: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      transcript: { select: { id: true, speakerLabelsCorrected: true, speakerCorrectedAt: true } },
      manualReviews: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, scorePercent: true },
      },
    },
  });
}

export async function getCallDetail(clientId: string, callId: string) {
  return prisma.call.findFirst({
    where: { id: callId, clientId },
    include: {
      agent: true,
      team: true,
      campaign: true,
      client: { select: { id: true, name: true } },
      transcript: { include: { segments: { orderBy: { sequence: "asc" } } } },
      aiAudits: {
        orderBy: [{ isLatest: "desc" }, { auditRunNo: "desc" }, { createdAt: "desc" }],
        include: {
          parameterScores: { include: { parameter: true }, orderBy: { id: "asc" } },
        },
      },
      insights: { orderBy: { createdAt: "desc" } },
      manualReviews: { orderBy: { createdAt: "desc" } },
      notes: { orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }] },
      events: { orderBy: { occurredAt: "asc" } },
    },
  });
}

export async function getCallUploadOptions(clientId: string) {
  const [client, campaigns, teams, agents] = await Promise.all([
    prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true },
    }),
    prisma.campaign.findMany({
      where: { clientId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.team.findMany({
      where: { clientId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.agent.findMany({
      where: { clientId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, teamId: true },
    }),
  ]);
  return { client, campaigns, teams, agents };
}

export type CallListItem = Awaited<ReturnType<typeof listCalls>>[number];
export type CallDetail = NonNullable<Awaited<ReturnType<typeof getCallDetail>>>;
export type CallUploadOptions = Awaited<ReturnType<typeof getCallUploadOptions>>;

export const CALL_STATUS_VALUES: readonly CallStatus[] = [
  "COMPLETED",
  "MISSED",
  "FAILED",
  "DROPPED",
  "TRANSFERRED",
  "UNKNOWN",
] as const;
