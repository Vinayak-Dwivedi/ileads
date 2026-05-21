import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { mutation, query } from "../procedure";
import { ApiError } from "../errors";
import { generateWebhookSecret, WEBHOOK_EVENTS } from "@/lib/webhooks";

const EventNameSchema = z.union([
  z.enum(WEBHOOK_EVENTS as unknown as readonly [string, ...string[]]),
  z.literal("*"),
]);

const WebhookSelect = {
  id: true,
  label: true,
  url: true,
  events: true,
  isActive: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const webhooksRouter = {
  list: query("webhooks.list", {
    input: z.object({}).default({}),
    scope: "webhooks:read",
    async handler({ ctx }) {
      return prisma.webhook.findMany({
        where: { clientId: ctx.actor.clientId },
        orderBy: { createdAt: "desc" },
        select: WebhookSelect,
      });
    },
  }),

  get: query("webhooks.get", {
    input: z.object({ id: z.string() }),
    scope: "webhooks:read",
    async handler({ ctx, input }) {
      const row = await prisma.webhook.findFirst({
        where: { id: input.id, clientId: ctx.actor.clientId },
        select: WebhookSelect,
      });
      if (!row) throw new ApiError("NOT_FOUND", "Webhook not found.");
      return row;
    },
  }),

  create: mutation("webhooks.create", {
    input: z.object({
      label: z.string().min(1).max(120),
      url: z.string().url().max(2048),
      events: z.array(EventNameSchema).min(1).default(["*"]),
    }),
    scope: "webhooks:write",
    audit: {
      action: "WEBHOOK_CREATED",
      entity: "Webhook",
      entityId: ({ output }) => (output as { id: string }).id,
      diff: ({ input }) => ({ label: input.label, url: input.url, events: input.events }),
    },
    async handler({ ctx, input }) {
      const secret = generateWebhookSecret();
      const created = await prisma.webhook.create({
        data: {
          clientId: ctx.actor.clientId,
          label: input.label,
          url: input.url,
          events: input.events as unknown as object,
          secret,
          createdByUserId: ctx.actor.userId ?? null,
          isActive: true,
        },
        select: WebhookSelect,
      });
      // Plaintext secret only ever returned on create — like API keys.
      return { ...created, secret };
    },
  }),

  update: mutation("webhooks.update", {
    input: z.object({
      id: z.string(),
      label: z.string().min(1).max(120).optional(),
      url: z.string().url().max(2048).optional(),
      events: z.array(EventNameSchema).min(1).optional(),
      isActive: z.boolean().optional(),
    }),
    scope: "webhooks:write",
    audit: {
      action: "WEBHOOK_UPDATED",
      entity: "Webhook",
      entityId: ({ input }) => input.id,
      diff: ({ input }) => {
        const { id: _id, ...rest } = input;
        return rest;
      },
    },
    async handler({ ctx, input }) {
      const existing = await prisma.webhook.findFirst({
        where: { id: input.id, clientId: ctx.actor.clientId },
        select: { id: true },
      });
      if (!existing) throw new ApiError("NOT_FOUND", "Webhook not found.");
      return prisma.webhook.update({
        where: { id: input.id },
        data: {
          label: input.label,
          url: input.url,
          events: input.events ? (input.events as unknown as object) : undefined,
          isActive: input.isActive,
        },
        select: WebhookSelect,
      });
    },
  }),

  delete: mutation("webhooks.delete", {
    input: z.object({ id: z.string() }),
    scope: "webhooks:write",
    audit: {
      action: "WEBHOOK_DELETED",
      entity: "Webhook",
      entityId: ({ input }) => input.id,
    },
    async handler({ ctx, input }) {
      const existing = await prisma.webhook.findFirst({
        where: { id: input.id, clientId: ctx.actor.clientId },
        select: { id: true },
      });
      if (!existing) throw new ApiError("NOT_FOUND", "Webhook not found.");
      await prisma.webhook.delete({ where: { id: input.id } });
      return { id: input.id, deleted: true };
    },
  }),

  listDeliveries: query("webhooks.listDeliveries", {
    input: z.object({
      id: z.string(),
      take: z.coerce.number().int().positive().max(200).default(50),
    }),
    scope: "webhooks:read",
    async handler({ ctx, input }) {
      const existing = await prisma.webhook.findFirst({
        where: { id: input.id, clientId: ctx.actor.clientId },
        select: { id: true },
      });
      if (!existing) throw new ApiError("NOT_FOUND", "Webhook not found.");
      return prisma.webhookDelivery.findMany({
        where: { webhookId: input.id },
        orderBy: { createdAt: "desc" },
        take: input.take,
      });
    },
  }),
};
