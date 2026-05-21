import "server-only";
import { prisma } from "@/lib/db";
import { verifySession } from "@/lib/session";
import { logger } from "@/lib/logger";

export interface AuditLogInput {
  action: string;
  entity?: string;
  entityId?: string;
  clientId?: string;
  actorUserId?: string;
  actorClientAccessId?: string;
  diff?: unknown;
  ipAddress?: string;
  userAgent?: string;
  // Convenience: if provided, the session token is unwrapped to fill
  // clientId / actorUserId / actorClientAccessId.
  tokenForActor?: string;
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  let { clientId, actorUserId, actorClientAccessId } = input;

  if (input.tokenForActor) {
    const payload = await verifySession(input.tokenForActor);
    if (payload) {
      clientId ??= payload.clientId;
      if (payload.userId) actorUserId ??= payload.userId;
      else actorClientAccessId ??= payload.accessId;
    }
  }

  if (!clientId) {
    logger.warn("audit_log_no_client", { action: input.action });
    return;
  }

  try {
    await prisma.auditLog.create({
      data: {
        clientId,
        actorUserId: actorUserId ?? null,
        actorClientAccessId: actorClientAccessId ?? null,
        action: input.action,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        diff: input.diff == null ? undefined : (input.diff as object),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (err) {
    // Audit logging must never break the user-facing request.
    logger.error("audit_log_write_failed", {
      action: input.action,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
