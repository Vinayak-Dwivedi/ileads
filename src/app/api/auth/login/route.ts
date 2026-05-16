import { NextResponse } from "next/server";
import { attemptPasswordLogin, setSessionCookie } from "@/lib/auth";
import { buildPublicRedirect, sanitizeNextPath, withBasePath } from "@/lib/base-path";

export const runtime = "nodejs";

function redirectTo(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: location } });
}

export async function POST(request: Request) {
  let password = "";
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as { password?: string };
    password = body.password ?? "";
  } else {
    const form = await request.formData();
    password = String(form.get("password") ?? "");
  }

  const token = await attemptPasswordLogin(password);
  const nextParam = new URL(request.url).searchParams.get("next");
  if (!token) {
    const params = new URLSearchParams({ error: "1" });
    if (nextParam) params.set("next", sanitizeNextPath(nextParam));
    return redirectTo(`${withBasePath("/login")}?${params.toString()}`);
  }

  await setSessionCookie(token);
  return redirectTo(buildPublicRedirect(nextParam));
}
