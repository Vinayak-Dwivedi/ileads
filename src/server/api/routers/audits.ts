import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { mutation, query } from "../procedure";
import { ApiError } from "../errors";
import { enqueueCallProcessing, isQueueEnabled } from "@/lib/queue";
import { assertQuotaAllows } from "@/lib/quotas";

async function assertCallBelongsToClient(callId: string, clientId: string) {
  const call = await prisma.call.findFirst({
    where: { id: callId, clientId },
    select: { id: true },
  });
  if (!call) throw new ApiError("NOT_FOUND", "Call not found.");
}

const ParameterScoreInclude = {
  parameterScores: {
    include: {
      parameter: {
        select: { id: true, parameterName: true, parameterCategory: true, maxScore: true },
      },
    },
  },
} as const;

// Re-audit batch input: pick calls by explicit IDs OR by filter. Pass
// `callIds` for surgical re-runs (e.g. prompt iteration on a known set) and
// the filter for date/agent/campaign sweeps. At least one must be provided.
const RerunInput = z
  .object({
    callIds: z.array(z.string()).max(1000).optional(),
    campaignId: z.string().optional(),
    agentId: z.string().optional(),
    teamId: z.string().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: z.coerce.number().int().positive().max(1000).default(100),
  })
  .refine(
    (v) =>
      (v.callIds && v.callIds.length > 0) ||
      v.campaignId ||
      v.agentId ||
      v.teamId ||
      v.from ||
      v.to,
    { message: "Provide callIds OR at least one filter (campaign/agent/team/date)." },
  );

export const auditsRouter = {
  listForCall: query("audits.listForCall", {
    input: z.object({ callId: z.string() }),
    scope: "audits:read",
    async handler({ ctx, input }) {
      await assertCallBelongsToClient(input.callId, ctx.actor.clientId);
      return prisma.aiAudit.findMany({
        where: { callId: input.callId },
        orderBy: { createdAt: "desc" },
        include: ParameterScoreInclude,
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
        include: ParameterScoreInclude,
      });
      if (!row) throw new ApiError("NOT_FOUND", "No audit available yet.");
      return row;
    },
  }),

  rerun: mutation("audits.rerun", {
    input: RerunInput,
    scope: "audits:write",
    audit: {
      action: "AUDIT_RERUN_BATCH",
      entity: "Call",
      diff: ({ input, output }) => ({
        requested: input.callIds?.length ?? null,
        filter: {
          campaignId: input.campaignId,
          agentId: input.agentId,
          teamId: input.teamId,
          from: input.from,
          to: input.to,
          limit: input.limit,
        },
        enqueued: (output as { enqueued: number }).enqueued,
      }),
    },
    async handler({ ctx, input }) {
      const clientId = ctx.actor.clientId;

      let calls: Array<{ id: string }>;
      if (input.callIds && input.callIds.length > 0) {
        // Only re-audit calls the caller's client owns.
        calls = await prisma.call.findMany({
          where: { id: { in: input.callIds }, clientId },
          select: { id: true },
        });
      } else {
        const where: Record<string, unknown> = { clientId };
        if (input.campaignId) where.campaignId = input.campaignId;
        if (input.agentId) where.agentId = input.agentId;
        if (input.teamId) where.teamId = input.teamId;
        if (input.from || input.to) {
          where.callStartedAt = {
            ...(input.from ? { gte: input.from } : {}),
            ...(input.to ? { lte: input.to } : {}),
          };
        }
        calls = await prisma.call.findMany({
          where,
          orderBy: { callStartedAt: "desc" },
          take: input.limit,
          select: { id: true },
        });
      }

      if (calls.length === 0) {
        return { enqueued: 0, callIds: [], queueAvailable: isQueueEnabled() };
      }

      // Hard-quota pre-check for the whole batch.
      await assertQuotaAllows(clientId, "AUDITS_PER_DAY", calls.length);

      // Mark every selected call as uploaded so the in-process worker picks
      // them up too (BullMQ path uses the enqueue below). Wipe stale error
      // state to give the re-audit a clean slate.
      await prisma.call.updateMany({
        where: { id: { in: calls.map((c) => c.id) } },
        data: {
          processingStatus: "uploaded",
          processingStartedAt: null,
          processingError: null,
        },
      });

      // Enqueue in parallel. enqueueCallProcessing no-ops when Redis isn't
      // configured — the polling worker covers that case.
      await Promise.all(
        calls.map((c) => enqueueCallProcessing({ callId: c.id, clientId })),
      );

      return {
        enqueued: calls.length,
        callIds: calls.map((c) => c.id),
        queueAvailable: isQueueEnabled(),
      };
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
