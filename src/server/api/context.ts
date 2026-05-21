import "server-only";
import { getSession, type AuthenticatedSession } from "@/lib/auth";
import { newTraceId } from "@/lib/logger";
import { ApiError } from "./errors";

export interface ActorIdentity {
  // Where the request came from. Drives audit-log attribution and rate-limit
  // bucket selection.
  source: "session" | "api_key";
  clientId: string;
  // userId is set for per-user sessions and for API keys (createdByUserId).
  userId?: string;
  // accessId is the ClientAccess id for legacy sessions.
  accessId?: string;
  // apiKeyPrefix is set for API-key calls; nice for audit logs + traces.
  apiKeyPrefix?: string;
  role?: "OWNER" | "AUDITOR" | "AGENT" | "VIEWER";
  scopes?: string[];
}

export interface Context {
  actor: ActorIdentity;
  traceId: string;
  ip?: string;
  userAgent?: string;
}

/** Build a Context from the browser session cookie. Throws if not authenticated. */
export async function createContextFromSession(opts: {
  ip?: string;
  userAgent?: string;
} = {}): Promise<Context> {
  const session = await getSession();
  if (!session) throw new ApiError("UNAUTHORIZED", "Not signed in.");
  return {
    actor: actorFromSession(session),
    traceId: newTraceId(),
    ip: opts.ip,
    userAgent: opts.userAgent,
  };
}

export function actorFromSession(session: AuthenticatedSession): ActorIdentity {
  return {
    source: "session",
    clientId: session.clientId,
    userId: session.userId,
    accessId: session.userId ? undefined : session.accessId,
    role: session.role,
  };
}

/** Build a Context for an API-key-authenticated request. */
export function buildApiKeyContext(opts: {
  clientId: string;
  apiKeyPrefix: string;
  createdByUserId?: string;
  scopes: string[];
  ip?: string;
  userAgent?: string;
}): Context {
  return {
    actor: {
      source: "api_key",
      clientId: opts.clientId,
      apiKeyPrefix: opts.apiKeyPrefix,
      userId: opts.createdByUserId,
      scopes: opts.scopes,
    },
    traceId: newTraceId(),
    ip: opts.ip,
    userAgent: opts.userAgent,
  };
}

export function requireScope(ctx: Context, scope: string): void {
  if (ctx.actor.source !== "api_key") return; // session callers are not scope-checked here
  const scopes = ctx.actor.scopes ?? [];
  if (scopes.includes("*") || scopes.includes(scope)) return;
  throw new ApiError("FORBIDDEN", `Missing required scope: ${scope}`);
}
