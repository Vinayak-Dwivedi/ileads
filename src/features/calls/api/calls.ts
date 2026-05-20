import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

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

function buildWhere(clientId: string, filters: CallListFilters): Prisma.CallWhereInput {
  const where: Prisma.CallWhereInput = { clientId };

  if (filters.campaignId) where.campaignId = filters.campaignId;
  if (filters.teamId) where.teamId = filters.teamId;
  if (filters.agentId) where.agentId = filters.agentId;
  if (filters.sentiment) {
    where.sentiment = { equals: filters.sentiment, mode: "insensitive" };
  }
  if (filters.manualDisposition) {
    where.manualDisposition = filters.manualDisposition;
  }
  if (filters.auditStatus) {
    const status = filters.auditStatus.toUpperCase();
    if (status === "AUDITED") where.aiScore = { not: null };
    else if (status === "PENDING") where.aiScore = null;
    else if (status === "IN_REVIEW") {
      where.manualReviews = {
        some: { status: { in: ["PENDING", "IN_PROGRESS"] } },
      };
    }
  }
  if (filters.from || filters.to) {
    where.callStartedAt = {};
    if (filters.from) where.callStartedAt.gte = filters.from;
    if (filters.to) where.callStartedAt.lte = filters.to;
  }
  if (filters.search) {
    const query = filters.search.trim();
    where.OR = [
      { id: { contains: query, mode: "insensitive" } },
      { externalCallId: { contains: query, mode: "insensitive" } },
      { callerNumber: { contains: query } },
      { calleeNumber: { contains: query } },
      { customerName: { contains: query, mode: "insensitive" } },
      { agent: { name: { contains: query, mode: "insensitive" } } },
    ];
  }

  return where;
}

export async function listCalls(
  clientId: string,
  filters: CallListFilters = {},
  take = 100,
) {
  // TODO: clean up duplicate query logic with src/lib/data/calls.ts once calls
  // has fully moved to a feature-owned API boundary.
  return prisma.call.findMany({
    where: buildWhere(clientId, filters),
    orderBy: [{ callStartedAt: "desc" }, { createdAt: "desc" }],
    take,
    include: {
      agent: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      transcript: {
        select: {
          id: true,
          speakerLabelsCorrected: true,
          speakerCorrectedAt: true,
        },
      },
      manualReviews: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, scorePercent: true },
      },
    },
  });
}

export async function getCallUploadOptions(clientId: string) {
  // TODO: clean up duplicate upload option query with src/lib/data/calls.ts
  // after all call route data access is feature-owned.
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
export type CallUploadOptions = Awaited<ReturnType<typeof getCallUploadOptions>>;
