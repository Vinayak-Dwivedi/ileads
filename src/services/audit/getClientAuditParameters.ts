import "server-only";
import { prisma } from "@/lib/db";
import type { ClientParameter } from "@prisma/client";

/**
 * Return the active client parameters that an audit should score against.
 * Inactive parameters are excluded — they shouldn't appear on a new audit
 * even if they show up in historical scores.
 */
export async function getClientAuditParameters(clientId: string): Promise<ClientParameter[]> {
  return prisma.clientParameter.findMany({
    where: { clientId, isActive: true },
    orderBy: [
      { displayOrder: "asc" },
      { parameterCategory: "asc" },
      { parameterName: "asc" },
    ],
  });
}
