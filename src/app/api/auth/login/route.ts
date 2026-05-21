import { NextResponse } from "next/server";
import { z } from "zod";
import { attemptPasswordLogin, setSessionCookie } from "@/lib/auth";
import { buildPublicRedirect, sanitizeNextPath, withBasePath } from "@/lib/base-path";
import { checkLoginRateLimit, recordLoginFailure, resetLoginRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const LoginSchema = z.object({
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
  const limit = checkLoginRateLimit(ip);
  if (!limit.allowed) {
    return new NextResponse("Too many login attempts. Try again later.", {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
    });
  }

  let rawPassword = "";
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as { password?: unknown };
    rawPassword = typeof body.password === "string" ? body.password : "";
  } else {
    const form = await request.formData();
    rawPassword = String(form.get("password") ?? "");
  }

  const parsed = LoginSchema.safeParse({ password: rawPassword });
  const nextParam = new URL(request.url).searchParams.get("next");

  if (!parsed.success) {
    recordLoginFailure(ip);
    const params = new URLSearchParams({ error: "1" });
    if (nextParam) params.set("next", sanitizeNextPath(nextParam));
    return redirectTo(`${withBasePath("/login")}?${params.toString()}`);
  }

  const token = await attemptPasswordLogin(parsed.data.password);
  if (!token) {
    recordLoginFailure(ip);
    console.warn(
      JSON.stringify({ ts: new Date().toISOString(), event: "login_failed", ip }),
    );
    const params = new URLSearchParams({ error: "1" });
    if (nextParam) params.set("next", sanitizeNextPath(nextParam));
    return redirectTo(`${withBasePath("/login")}?${params.toString()}`);
  }

  resetLoginRateLimit(ip);
  await setSessionCookie(token);
  return redirectTo(buildPublicRedirect(nextParam));
}
