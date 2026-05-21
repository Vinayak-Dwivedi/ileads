import "server-only";

import { prisma } from "@/lib/db";
import { formatShortDate } from "@/lib/utils";

export interface AgentTableRow {
  id: string;
  name: string;
  employeeCode: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  campaignId: string | null;
  campaignName: string | null;
  teamName: string | null;
  callCount: number;
  searchText: string;
}

export interface AgentCampaignOption {
  id: string;
  name: string;
}

export interface AgentsPageData {
  agents: AgentTableRow[];
  campaigns: AgentCampaignOption[];
}

export async function getAgentsPageData(clientId: string): Promise<AgentsPageData> {
  // TODO: consolidate this duplicated agents query into a feature-owned data layer
  // once all route pages have moved away from direct app-folder Prisma access.
  const [agents, campaigns] = await Promise.all([
    prisma.agent.findMany({
      where: { clientId },
      include: {
        campaign: {
          select: { name: true },
        },
        team: {
          select: { name: true },
        },
        _count: {
          select: { calls: true },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.campaign.findMany({
      where: { clientId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    campaigns,
    agents: agents.map((agent) => {
      const campaignName = agent.campaign?.name ?? null;
      const teamName = agent.team?.name ?? null;
      const callCount = agent._count.calls;

      return {
        id: agent.id,
        name: agent.name,
        employeeCode: agent.employeeCode,
        email: agent.email,
        isActive: agent.isActive,
        createdAt: formatShortDate(agent.createdAt),
        updatedAt: formatShortDate(agent.updatedAt),
        campaignId: agent.campaignId,
        campaignName,
        teamName,
        callCount,
        searchText: [
          agent.name,
          agent.employeeCode,
          agent.email,
          teamName,
          campaignName,
          agent.isActive ? "active" : "inactive",
          callCount > 0 ? "has call history" : "no call history",
        ]
          .filter(Boolean)
          .join(" "),
      };
    }),
  };
}
