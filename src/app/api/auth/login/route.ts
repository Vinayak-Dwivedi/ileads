import { NextResponse } from "next/server";
import { z } from "zod";
import { attemptPasswordLogin, attemptUserLogin, setSessionCookie } from "@/lib/auth";
import { buildPublicRedirect, sanitizeNextPath, withBasePath } from "@/lib/base-path";
import { checkLoginRateLimit, recordLoginFailure, resetLoginRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { writeAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";

const LoginSchema = z.object({
  email: z.string().email().max(256).optional(),
  password: z.string().min(1).max(512),
});

function redirectTo(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: location } });
}

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const ua = request.headers.get("user-agent") ?? undefined;
  const limit = checkLoginRateLimit(ip);
  if (!limit.allowed) {
    return new NextResponse("Too many login attempts. Try again later.", {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
    });
  }

  let rawEmail = "";
  let rawPassword = "";
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as {
      email?: unknown;
      password?: unknown;
    };
    rawEmail = typeof body.email === "string" ? body.email : "";
    rawPassword = typeof body.password === "string" ? body.password : "";
  } else {
    const form = await request.formData();
    rawEmail = String(form.get("email") ?? "").trim();
    rawPassword = String(form.get("password") ?? "");
  }

  const parsed = LoginSchema.safeParse({
    email: rawEmail || undefined,
    password: rawPassword,
  });
  const nextParam = new URL(request.url).searchParams.get("next");

  if (!parsed.success) {
    recordLoginFailure(ip);
    const params = new URLSearchParams({ error: "1" });
    if (nextParam) params.set("next", sanitizeNextPath(nextParam));
    return redirectTo(`${withBasePath("/login")}?${params.toString()}`);
  }

  // Try user-based login first (if email provided), then fall back to legacy.
  let token: string | null = null;
  let loginMode: "user" | "legacy" | null = null;
  if (parsed.data.email) {
    token = await attemptUserLogin(parsed.data.email, parsed.data.password);
    if (token) loginMode = "user";
  }
  if (!token) {
    token = await attemptPasswordLogin(parsed.data.password);
    if (token) loginMode = "legacy";
  }

  if (!token) {
    recordLoginFailure(ip);
    logger.warn("login_failed", { ip, email: parsed.data.email ?? null });
    const params = new URLSearchParams({ error: "1" });
    if (nextParam) params.set("next", sanitizeNextPath(nextParam));
    return redirectTo(`${withBasePath("/login")}?${params.toString()}`);
  }

  resetLoginRateLimit(ip);
  await setSessionCookie(token);

  // Fire-and-forget audit log
  void writeAuditLog({
    action: loginMode === "user" ? "LOGIN_SUCCESS_USER" : "LOGIN_SUCCESS_LEGACY",
    ipAddress: ip,
    userAgent: ua,
    tokenForActor: token,
  }).catch((err) => logger.error("audit_log_failed", { err: String(err) }));

  return redirectTo(buildPublicRedirect(nextParam));
}
