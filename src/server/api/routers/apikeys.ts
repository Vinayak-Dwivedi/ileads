import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { mutation, query } from "../procedure";
import { ApiError } from "../errors";
import { generateApiKey } from "@/lib/api-key";

const ApiKeyView = {
  id: true,
  label: true,
  prefix: true,
  scopes: true,
  expiresAt: true,
  lastUsedAt: true,
  isActive: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Locked-down scope catalog. Keys can only be created with scopes from this
// set. "*" grants admin (all current and future scopes).
const KNOWN_SCOPES = [
  "*",
  "calls:read",
  "calls:write",
  "agents:read",
  "dashboard:read",
  "audits:read",
  "audits:write",
  "transcripts:read",
  "webhooks:read",
  "webhooks:write",
  "apikeys:read",
  "apikeys:write",
] as const;

const ScopeSchema = z.enum(KNOWN_SCOPES);

export const apikeysRouter = {
  list: query("apikeys.list", {
    input: z.object({}).default({}),
    scope: "apikeys:read",
    async handler({ ctx }) {
      return prisma.apiKey.findMany({
        where: { clientId: ctx.actor.clientId },
        orderBy: { createdAt: "desc" },
        select: ApiKeyView,
      });
    },
  }),

  get: query("apikeys.get", {
    input: z.object({ id: z.string() }),
    scope: "apikeys:read",
    async handler({ ctx, input }) {
      const row = await prisma.apiKey.findFirst({
        where: { id: input.id, clientId: ctx.actor.clientId },
        select: ApiKeyView,
      });
      if (!row) throw new ApiError("NOT_FOUND", "API key not found.");
      return row;
    },
  }),

  create: mutation("apikeys.create", {
    input: z.object({
      label: z.string().min(1).max(120),
      scopes: z.array(ScopeSchema).min(1),
      expiresInDays: z.number().int().positive().max(365 * 5).optional(),
    }),
    scope: "apikeys:write",
    audit: {
      action: "APIKEY_CREATED",
      entity: "ApiKey",
      entityId: ({ output }) => (output as { id: string }).id,
      diff: ({ input }) => ({ label: input.label, scopes: input.scopes }),
    },
    async handler({ ctx, input }) {
      const { plaintext, prefix, hashedSecret } = await generateApiKey();
      const expiresAt =
        input.expiresInDays && input.expiresInDays > 0
          ? new Date(Date.now() + input.expiresInDays * 24 * 3600 * 1000)
          : null;
      const created = await prisma.apiKey.create({
        data: {
          clientId: ctx.actor.clientId,
          label: input.label,
          prefix,
          hashedSecret,
          scopes: input.scopes as unknown as object,
          expiresAt,
          createdByUserId: ctx.actor.userId ?? null,
          isActive: true,
        },
        select: ApiKeyView,
      });
      // Plaintext returned only once — same contract as scripts/create-api-key.ts.
      return { ...created, plaintextKey: plaintext };
    },
  }),

  rotate: mutation("apikeys.rotate", {
    input: z.object({ id: z.string() }),
    scope: "apikeys:write",
    audit: {
      action: "APIKEY_ROTATED",
      entity: "ApiKey",
      entityId: ({ input }) => input.id,
    },
    async handler({ ctx, input }) {
      const existing = await prisma.apiKey.findFirst({
        where: { id: input.id, clientId: ctx.actor.clientId },
        select: { id: true },
      });
      if (!existing) throw new ApiError("NOT_FOUND", "API key not found.");
      const { plaintext, prefix, hashedSecret } = await generateApiKey();
      const updated = await prisma.apiKey.update({
        where: { id: input.id },
        data: { prefix, hashedSecret },
        select: ApiKeyView,
      });
      return { ...updated, plaintextKey: plaintext };
    },
  }),

  update: mutation("apikeys.update", {
    input: z.object({
      id: z.string(),
      label: z.string().min(1).max(120).optional(),
      scopes: z.array(ScopeSchema).min(1).optional(),
      isActive: z.boolean().optional(),
    }),
    scope: "apikeys:write",
    audit: {
      action: "APIKEY_UPDATED",
      entity: "ApiKey",
      entityId: ({ input }) => input.id,
      diff: ({ input }) => {
        const { id: _id, ...rest } = input;
        return rest;
      },
    },
    async handler({ ctx, input }) {
      const existing = await prisma.apiKey.findFirst({
        where: { id: input.id, clientId: ctx.actor.clientId },
        select: { id: true },
      });
      if (!existing) throw new ApiError("NOT_FOUND", "API key not found.");
      return prisma.apiKey.update({
        where: { id: input.id },
        data: {
          label: input.label,
          scopes: input.scopes ? (input.scopes as unknown as object) : undefined,
          isActive: input.isActive,
        },
        select: ApiKeyView,
      });
    },
  }),

  delete: mutation("apikeys.delete", {
    input: z.object({ id: z.string() }),
    scope: "apikeys:write",
    audit: {
      action: "APIKEY_DELETED",
      entity: "ApiKey",
      entityId: ({ input }) => input.id,
    },
    async handler({ ctx, input }) {
      const existing = await prisma.apiKey.findFirst({
        where: { id: input.id, clientId: ctx.actor.clientId },
        select: { id: true },
      });
      if (!existing) throw new ApiError("NOT_FOUND", "API key not found.");
      await prisma.apiKey.delete({ where: { id: input.id } });
      return { id: input.id, deleted: true };
    },
  }),
};

export const KNOWN_API_SCOPES = KNOWN_SCOPES;
