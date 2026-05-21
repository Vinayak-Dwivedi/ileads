import "server-only";
import { z, type ZodType } from "zod";
import { logger, withLogContext } from "@/lib/logger";
import { writeAuditLog } from "@/lib/audit-log";
import { ApiError } from "./errors";
import type { Context } from "./context";

export interface ProcedureOptions<I, O> {
  // Optional Zod schema for input validation.
  input?: ZodType<I>;
  // Optional scope required when called via an API key context.
  scope?: string;
  // Audit-log action name. When provided, the call is recorded after success
  // (entity/entityId derived from auditEntity()).
  audit?: {
    action: string;
    entity?: string;
    // Pull the entityId out of input or output. Inspected after the handler.
    entityId?: (data: { input: I; output: O }) => string | undefined;
    // Custom diff payload. Defaults to the input.
    diff?: (data: { input: I; output: O }) => unknown;
  };
  handler: (args: { ctx: Context; input: I }) => Promise<O>;
}

export interface ProcedureCallable<I, O> {
  (ctx: Context, input: I): Promise<O>;
  // Convenience for callers that don't need the wrapping (e.g. internal use).
  raw: (ctx: Context, input: I) => Promise<O>;
}

function buildAudit<I, O>(
  ctx: Context,
  input: I,
  output: O,
  audit: NonNullable<ProcedureOptions<I, O>["audit"]>,
): void {
  void writeAuditLog({
    action: audit.action,
    entity: audit.entity,
    entityId: audit.entityId?.({ input, output }),
    clientId: ctx.actor.clientId,
    actorUserId: ctx.actor.userId,
    actorClientAccessId: ctx.actor.accessId,
    diff: audit.diff ? audit.diff({ input, output }) : (input as unknown),
    ipAddress: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

function buildLogContext(ctx: Context, name: string) {
  return {
    traceId: ctx.traceId,
    clientId: ctx.actor.clientId,
    userId: ctx.actor.userId,
    procedure: name,
    source: ctx.actor.source,
  };
}

function makeProcedure<I, O>(
  name: string,
  opts: ProcedureOptions<I, O>,
  kind: "query" | "mutation",
): ProcedureCallable<I, O> {
  const callable = async (ctx: Context, input: I): Promise<O> => {
    return withLogContext(buildLogContext(ctx, name), async () => {
      const startMs = Date.now();
      let validated: I;
      try {
        validated = opts.input ? opts.input.parse(input) : input;
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new ApiError("INVALID_INPUT", "Invalid input.", err.flatten());
        }
        throw err;
      }

      if (opts.scope && ctx.actor.source === "api_key") {
        const scopes = ctx.actor.scopes ?? [];
        if (!scopes.includes("*") && !scopes.includes(opts.scope)) {
          throw new ApiError("FORBIDDEN", `Missing required scope: ${opts.scope}`);
        }
      }

      try {
        const output = await opts.handler({ ctx, input: validated });
        if (kind === "mutation" && opts.audit) {
          buildAudit(ctx, validated, output, opts.audit);
        }
        logger.debug("procedure_ok", { kind, durationMs: Date.now() - startMs });
        return output;
      } catch (err) {
        const durationMs = Date.now() - startMs;
        if (err instanceof ApiError) {
          logger.warn("procedure_api_error", { kind, code: err.code, durationMs });
        } else {
          logger.error("procedure_error", {
            kind,
            durationMs,
            err: err instanceof Error ? err.message : String(err),
          });
        }
        throw err;
      }
    }) as Promise<O>;
  };
  return Object.assign(callable, { raw: callable });
}

export function query<I, O>(name: string, opts: ProcedureOptions<I, O>) {
  return makeProcedure(name, opts, "query");
}

export function mutation<I, O>(name: string, opts: ProcedureOptions<I, O>) {
  return makeProcedure(name, opts, "mutation");
}
