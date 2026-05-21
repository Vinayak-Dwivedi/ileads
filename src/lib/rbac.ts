import "server-only";
import { NextResponse } from "next/server";
import { getSession, type AuthenticatedSession } from "@/lib/auth";

export type Role = "OWNER" | "AUDITOR" | "AGENT" | "VIEWER";

// Higher number = more privileged.
const RANK: Record<Role, number> = {
  OWNER: 40,
  AUDITOR: 30,
  AGENT: 20,
  VIEWER: 10,
};

// Legacy single-password sessions have no role; treat them as OWNER so the
// existing app keeps working until clients migrate to per-user logins.
function effectiveRole(session: AuthenticatedSession): Role {
  return session.role ?? "OWNER";
}

export function sessionHasRole(session: AuthenticatedSession, min: Role): boolean {
  return RANK[effectiveRole(session)] >= RANK[min];
}

export interface RoleCheckOk {
  ok: true;
  session: AuthenticatedSession;
}
export interface RoleCheckFail {
  ok: false;
  response: NextResponse;
}

export async function requireRole(min: Role): Promise<RoleCheckOk | RoleCheckFail> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }
  if (!sessionHasRole(session, min)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Forbidden. Required role: ${min}.` },
        { status: 403 },
      ),
    };
  }
  return { ok: true, session };
}
