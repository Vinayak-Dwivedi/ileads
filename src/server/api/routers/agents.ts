import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { query } from "../procedure";
import { ApiError } from "../errors";

const AgentListInput = z.object({
  search: z.string().max(256).optional(),
  isActive: z.coerce.boolean().optional(),
  take: z.coerce.number().int().positive().max(500).default(100),
  cursor: z.string().optional(),
});

const AgentInclude = {
  campaign: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  _count: { select: { calls: true } },
} as const;

export const agentsRouter = {
  list: query("agents.list", {
    input: AgentListInput,
    scope: "agents:read",
    async handler({ ctx, input }) {
      const where = { clientId: ctx.actor.clientId } as Record<string, unknown>;
      if (input.isActive != null) where.isActive = input.isActive;
      if (input.search) {
        const q = input.search.trim();
        where.OR = [
          { name: { contains: q, mode: "insensitive" } },
          { employeeCode: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
        ];
      }
      const rows = await prisma.agent.findMany({
        where,
        orderBy: { name: "asc" },
        take: input.take + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        skip: input.cursor ? 1 : 0,
        include: AgentInclude,
      });
      const hasMore = rows.length > input.take;
      const items = hasMore ? rows.slice(0, input.take) : rows;
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1].id : null,
      };
    },
  }),

  get: query("agents.get", {
    input: z.object({ id: z.string() }),
    scope: "agents:read",
    async handler({ ctx, input }) {
      const row = await prisma.agent.findFirst({
        where: { id: input.id, clientId: ctx.actor.clientId },
        include: AgentInclude,
      });
      if (!row) throw new ApiError("NOT_FOUND", "Agent not found.");
      return row;
    },
  }),
};
