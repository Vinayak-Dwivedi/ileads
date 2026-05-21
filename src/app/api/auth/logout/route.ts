import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearSessionCookie } from "@/lib/auth";
import { withBasePath } from "@/lib/base-path";
import { writeAuditLog } from "@/lib/audit-log";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST() {
  // Capture token before we clear, so we can attribute the audit log.
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;

  await clearSessionCookie();

  if (token) {
    void writeAuditLog({ action: "LOGOUT", tokenForActor: token }).catch((err) =>
      logger.error("audit_log_failed", { err: String(err) }),
    );
  }

  return new NextResponse(null, {
    status: 303,
    headers: { Location: withBasePath("/login") },
  });
}
