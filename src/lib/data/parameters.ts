import "server-only";
import { prisma } from "@/lib/db";

export interface ParameterFilters {
  search?: string;
  category?: string;
  clientId?: string;
}

export async function listParameters(clientId: string, filters: ParameterFilters = {}) {
  const where: import("@prisma/client").Prisma.ClientParameterWhereInput = { clientId };
  if (filters.category) where.parameterCategory = filters.category;
  if (filters.search) {
    where.OR = [
      { parameterName: { contains: filters.search, mode: "insensitive" } },
      { parameterDescription: { contains: filters.search, mode: "insensitive" } },
      { parameterCategory: { contains: filters.search, mode: "insensitive" } },
    ];
  }
  return prisma.clientParameter.findMany({
    where,
    orderBy: [
      { parameterCategory: "asc" },
      { displayOrder: "asc" },
      { parameterName: "asc" },
    ],
    include: {
      _count: { select: { aiParameterScores: true } },
    },
  });
}

export async function listParameterCategories(clientId: string) {
  const rows = await prisma.clientParameter.findMany({
    where: { clientId },
    select: { parameterCategory: true },
    distinct: ["parameterCategory"],
    orderBy: { parameterCategory: "asc" },
  });
  return rows.map((r) => r.parameterCategory);
}

export async function getParameter(clientId: string, id: string) {
  return prisma.clientParameter.findFirst({ where: { id, clientId } });
}
