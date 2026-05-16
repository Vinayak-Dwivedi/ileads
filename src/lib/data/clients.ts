import "server-only";
import { prisma } from "@/lib/db";

export async function listClients() {
  return prisma.client.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: {
      _count: {
        select: { calls: true, agents: true, campaigns: true, parameters: true, teams: true },
      },
    },
  });
}

export async function getClient(id: string) {
  return prisma.client.findUnique({ where: { id } });
}
