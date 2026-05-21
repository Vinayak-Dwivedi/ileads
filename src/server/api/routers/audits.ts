import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { query } from "../procedure";
import { ApiError } from "../errors";

async function assertCallBelongsToClient(callId: string, clientId: string) {
  const call = await prisma.call.findFirst({
    where: { id: callId, clientId },
    select: { id: true },
  });
  if (!call) throw new ApiError("NOT_FOUND", "Call not found.");
}

export const auditsRouter = {
  listForCall: query("audits.listForCall", {
    input: z.object({ callId: z.string() }),
    scope: "audits:read",
    async handler({ ctx, input }) {
      await assertCallBelongsToClient(input.callId, ctx.actor.clientId);
      return prisma.aiAudit.findMany({
        where: { callId: input.callId },
        orderBy: { createdAt: "desc" },
        include: {
          parameterScores: {
            include: {
              parameter: {
                select: { id: true, parameterName: true, parameterCategory: true, maxScore: true },
              },
            },
          },
        },
      });
    },
  }),

  getLatest: query("audits.getLatest", {
    input: z.object({ callId: z.string() }),
    scope: "audits:read",
    async handler({ ctx, input }) {
      await assertCallBelongsToClient(input.callId, ctx.actor.clientId);
      const row = await prisma.aiAudit.findFirst({
        where: { callId: input.callId, isLatest: true },
        include: {
          parameterScores: {
            include: {
              parameter: {
                select: { id: true, parameterName: true, parameterCategory: true, maxScore: true },
              },
            },
          },
        },
      });
      if (!row) throw new ApiError("NOT_FOUND", "No audit available yet.");
      return row;
    },
  }),
};

export const transcriptsRouter = {
  getForCall: query("transcripts.getForCall", {
    input: z.object({ callId: z.string() }),
    scope: "transcripts:read",
    async handler({ ctx, input }) {
      await assertCallBelongsToClient(input.callId, ctx.actor.clientId);
      const transcript = await prisma.callTranscript.findUnique({
        where: { callId: input.callId },
        include: {
          segments: { orderBy: { sequence: "asc" } },
        },
      });
      if (!transcript) throw new ApiError("NOT_FOUND", "No transcript available.");
      return transcript;
    },
  }),
};
