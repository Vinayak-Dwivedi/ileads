import "server-only";
import { z } from "zod";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";

// OpenAPI 3.1 spec generated from Zod schemas. Each route is registered with
// its query/path/body schemas + a high-level response shape. We intentionally
// don't try to mirror every nested Prisma type — clients can rely on the
// JSON envelope and the procedure's input contract.

const registry = new OpenAPIRegistry();

// Auth scheme
registry.registerComponent("securitySchemes", "ApiKey", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "qms_live_<prefix>_<secret>",
  description: "Long-lived API key. Issue one via `npm run apikey:create`.",
});

const Envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ data });

const ErrorEnvelope = z.object({
  error: z.object({
    code: z.enum([
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "INVALID_INPUT",
      "CONFLICT",
      "RATE_LIMITED",
      "INTERNAL",
    ]),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

const StandardResponses = (data: z.ZodTypeAny) => ({
  200: {
    description: "Success.",
    content: { "application/json": { schema: Envelope(data) } },
  },
  400: errorResp("Invalid input."),
  401: errorResp("Missing or invalid API key."),
  403: errorResp("Missing required scope."),
  404: errorResp("Resource not found."),
  429: errorResp("Rate limit exceeded."),
  500: errorResp("Unexpected error."),
});
function errorResp(description: string) {
  return {
    description,
    content: { "application/json": { schema: ErrorEnvelope } },
  };
}

const Security = [{ ApiKey: [] }];

// ---- Calls ----
registry.registerPath({
  method: "get",
  path: "/api/v1/calls",
  tags: ["Calls"],
  summary: "List calls",
  security: Security,
  request: {
    query: z.object({
      search: z.string().optional(),
      campaignId: z.string().optional(),
      teamId: z.string().optional(),
      agentId: z.string().optional(),
      sentiment: z.string().optional(),
      auditStatus: z.enum(["AUDITED", "PENDING", "IN_REVIEW"]).optional(),
      manualDisposition: z.string().optional(),
      from: z.string().describe("ISO datetime").optional(),
      to: z.string().describe("ISO datetime").optional(),
      take: z.coerce.number().int().positive().max(500).optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: StandardResponses(
    z.object({
      items: z.array(z.object({ id: z.string() }).passthrough()),
      nextCursor: z.string().nullable(),
    }),
  ),
});
registry.registerPath({
  method: "get",
  path: "/api/v1/calls/{id}",
  tags: ["Calls"],
  summary: "Get a single call",
  security: Security,
  request: { params: z.object({ id: z.string() }) },
  responses: StandardResponses(z.object({ id: z.string() }).passthrough()),
});

// ---- Agents ----
registry.registerPath({
  method: "get",
  path: "/api/v1/agents",
  tags: ["Agents"],
  summary: "List agents",
  security: Security,
  request: {
    query: z.object({
      search: z.string().optional(),
      isActive: z.coerce.boolean().optional(),
      take: z.coerce.number().int().positive().max(500).optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: StandardResponses(
    z.object({
      items: z.array(z.object({ id: z.string() }).passthrough()),
      nextCursor: z.string().nullable(),
    }),
  ),
});
registry.registerPath({
  method: "get",
  path: "/api/v1/agents/{id}",
  tags: ["Agents"],
  summary: "Get a single agent",
  security: Security,
  request: { params: z.object({ id: z.string() }) },
  responses: StandardResponses(z.object({ id: z.string() }).passthrough()),
});

// ---- Audits / Transcripts ----
registry.registerPath({
  method: "get",
  path: "/api/v1/calls/{id}/audits",
  tags: ["Audits"],
  summary: "List all audit runs for a call",
  security: Security,
  request: { params: z.object({ id: z.string() }) },
  responses: StandardResponses(z.array(z.object({ id: z.string() }).passthrough())),
});
registry.registerPath({
  method: "get",
  path: "/api/v1/calls/{id}/audits/latest",
  tags: ["Audits"],
  summary: "Get the most recent audit run for a call",
  security: Security,
  request: { params: z.object({ id: z.string() }) },
  responses: StandardResponses(z.object({ id: z.string() }).passthrough()),
});
registry.registerPath({
  method: "get",
  path: "/api/v1/calls/{id}/transcript",
  tags: ["Transcripts"],
  summary: "Get the transcript + segments for a call",
  security: Security,
  request: { params: z.object({ id: z.string() }) },
  responses: StandardResponses(z.object({ id: z.string() }).passthrough()),
});

// ---- Dashboard ----
const DashboardFilterQuery = z.object({
  campaignId: z.string().optional(),
  teamId: z.string().optional(),
  agentId: z.string().optional(),
  from: z.string().describe("ISO datetime").optional(),
  to: z.string().describe("ISO datetime").optional(),
});
registry.registerPath({
  method: "get",
  path: "/api/v1/dashboard/kpis",
  tags: ["Dashboard"],
  summary: "Aggregate KPIs (totals + average scores)",
  security: Security,
  request: { query: DashboardFilterQuery },
  responses: StandardResponses(
    z.object({
      totalCalls: z.number(),
      aiAudited: z.number(),
      manualReviewed: z.number(),
      averageQualityPercent: z.number().nullable(),
      aiAuditScorePercent: z.number().nullable(),
      manualAuditScorePercent: z.number().nullable(),
      averageAuditScorePercent: z.number().nullable(),
    }),
  ),
});
registry.registerPath({
  method: "get",
  path: "/api/v1/dashboard/sentiment",
  tags: ["Dashboard"],
  summary: "Call sentiment breakdown",
  security: Security,
  request: { query: DashboardFilterQuery },
  responses: StandardResponses(
    z.object({
      positive: z.number(),
      neutral: z.number(),
      negative: z.number(),
      total: z.number(),
    }),
  ),
});
registry.registerPath({
  method: "get",
  path: "/api/v1/dashboard/scoreboard",
  tags: ["Dashboard"],
  summary: "Top-N agent quality scoreboard",
  security: Security,
  request: {
    query: DashboardFilterQuery.extend({
      limit: z.coerce.number().int().positive().max(50).optional(),
    }),
  },
  responses: StandardResponses(z.array(z.object({ rank: z.number() }).passthrough())),
});
registry.registerPath({
  method: "get",
  path: "/api/v1/dashboard/daily-quality",
  tags: ["Dashboard"],
  summary: "Per-day average quality score over a window",
  security: Security,
  request: {
    query: DashboardFilterQuery.extend({
      days: z.coerce.number().int().positive().max(180).optional(),
    }),
  },
  responses: StandardResponses(
    z.array(
      z.object({
        date: z.string(),
        averagePercent: z.number(),
        auditedCalls: z.number(),
      }),
    ),
  ),
});

// ---- Webhooks ----
const WebhookView = z.object({
  id: z.string(),
  label: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  isActive: z.boolean(),
  createdByUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
registry.registerPath({
  method: "get",
  path: "/api/v1/webhooks",
  tags: ["Webhooks"],
  summary: "List webhook subscriptions",
  security: Security,
  responses: StandardResponses(z.array(WebhookView)),
});
registry.registerPath({
  method: "post",
  path: "/api/v1/webhooks",
  tags: ["Webhooks"],
  summary: "Create webhook subscription (secret returned once)",
  security: Security,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            label: z.string(),
            url: z.string().url(),
            events: z.array(z.string()).min(1),
          }),
        },
      },
    },
  },
  responses: StandardResponses(WebhookView.extend({ secret: z.string() })),
});
registry.registerPath({
  method: "get",
  path: "/api/v1/webhooks/{id}",
  tags: ["Webhooks"],
  summary: "Get a webhook subscription",
  security: Security,
  request: { params: z.object({ id: z.string() }) },
  responses: StandardResponses(WebhookView),
});
registry.registerPath({
  method: "patch",
  path: "/api/v1/webhooks/{id}",
  tags: ["Webhooks"],
  summary: "Update a webhook subscription",
  security: Security,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            label: z.string().optional(),
            url: z.string().url().optional(),
            events: z.array(z.string()).optional(),
            isActive: z.boolean().optional(),
          }),
        },
      },
    },
  },
  responses: StandardResponses(WebhookView),
});
registry.registerPath({
  method: "delete",
  path: "/api/v1/webhooks/{id}",
  tags: ["Webhooks"],
  summary: "Delete a webhook subscription",
  security: Security,
  request: { params: z.object({ id: z.string() }) },
  responses: StandardResponses(z.object({ id: z.string(), deleted: z.literal(true) })),
});
registry.registerPath({
  method: "get",
  path: "/api/v1/webhooks/{id}/deliveries",
  tags: ["Webhooks"],
  summary: "List recent delivery attempts for a webhook",
  security: Security,
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({ take: z.coerce.number().int().positive().max(200).optional() }),
  },
  responses: StandardResponses(z.array(z.object({ id: z.string() }).passthrough())),
});

let cached: object | null = null;

export function buildOpenApiDocument() {
  if (cached) return cached;
  const generator = new OpenApiGeneratorV31(registry.definitions);
  cached = generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "iLeads QMS API",
      version: "1.0.0",
      description:
        "REST API for the iLeads Quality Management System. All endpoints require a Bearer API key with the scope listed on each operation.",
    },
    servers: [
      {
        url: process.env.APP_BASE_URL ?? "http://localhost:3000",
        description: "Configured deployment",
      },
    ],
  });
  return cached;
}
