import "server-only";

import { appRouter, actorFromSession } from "@/server/api";
import { getSession } from "@/lib/auth";
import { newTraceId } from "@/lib/logger";
import { ApiError } from "@/server/api";
import { prisma } from "@/lib/db";
import { formatShortDate } from "@/lib/utils";

// Public types preserved for existing page imports. Internally this now
// delegates to src/server/api/routers/agents.ts for the agent fetch, and
// keeps the page-data shaping (search text, formatted dates) here so the UI
// keeps its tidy contract.

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

async function sessionContext(clientId: string) {
  const session = await getSession();
  if (!session) throw new ApiError("UNAUTHORIZED", "Not signed in.");
  if (session.clientId !== clientId) {
    throw new ApiError("FORBIDDEN", "Session client does not match.");
  }
  return { actor: actorFromSession(session), traceId: newTraceId() };
}

export async function getAgentsPageData(clientId: string): Promise<AgentsPageData> {
  const ctx = await sessionContext(clientId);
  const [{ items: agents }, campaigns] = await Promise.all([
    appRouter.agents.list(ctx, { take: 500 } as never),
    // Campaign filter list isn't an agent operation — keep here as a small,
    // page-specific query. Could move into its own router method later.
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
