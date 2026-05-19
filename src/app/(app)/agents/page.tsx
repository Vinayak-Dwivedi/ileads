import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatShortDate } from "@/lib/utils";
import { AgentsClient } from "./agents-client";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const session = await requireSession();
  const clientId = session.clientId;

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

  const serializedAgents = agents.map((agent) => ({
    ...agent,
    createdAt: formatShortDate(agent.createdAt),
    updatedAt: formatShortDate(agent.updatedAt),
  }));

  return <AgentsClient agents={serializedAgents} campaigns={campaigns} />;
}
