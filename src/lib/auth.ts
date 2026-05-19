// Node-side authentication helpers. Uses bcrypt to verify passwords against
// the ClientAccess table; cookie signing/verification lives in lib/session.
// All routes that need to know "who is logged in" should call getSession().

import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  signSession,
  verifySession,
  type SessionPayload,
} from "@/lib/session";

import { redirect } from "next/navigation";

export interface AuthenticatedSession extends SessionPayload {
  clientName: string;
}

export async function getSession(): Promise<AuthenticatedSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  const payload = await verifySession(token);
  if (!payload) return null;
  const access = await prisma.clientAccess.findFirst({
    where: { id: payload.accessId, isActive: true },
    include: { client: true },
  });
  if (!access || access.client.id !== payload.clientId || !access.client.isActive) return null;
  return { ...payload, clientName: access.client.name };
}

export async function requireSession(): Promise<AuthenticatedSession> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export async function attemptPasswordLogin(password: string): Promise<string | null> {
  if (!password) return null;
  const candidates = await prisma.clientAccess.findMany({
    where: { isActive: true, client: { isActive: true } },
  });
  for (const access of candidates) {
    const ok = await bcrypt.compare(password, access.passwordHash);
    if (ok) {
      await prisma.clientAccess.update({
        where: { id: access.id },
        data: { lastUsedAt: new Date() },
      });
      return signSession({ accessId: access.id, clientId: access.clientId });
    }
  }
  return null;
}

function shouldUseSecureCookies(): boolean {
  return (process.env.APP_BASE_URL ?? "").startsWith("https://");
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookies(),
    path: "/",
    maxAge: 0,
  });
}
