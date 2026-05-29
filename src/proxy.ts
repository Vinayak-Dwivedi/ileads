import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/session";
import { BASE_PATH } from "@/lib/base-path";
import { prisma } from "@/lib/db";

// Notes on basePath handling here:
//  - `request.nextUrl.pathname` is ALREADY stripped of basePath, so the path
//    we compare against is the "logical" path (e.g. "/login").
//  - The proxy runtime requires absolute redirect URLs. Build those from
//    forwarded public headers, never from request.url's internal upstream
//    origin.
//  - The `matcher` below is also matched against the basePath-stripped path.

function publicOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  if (!host && process.env.APP_BASE_URL) return new URL(process.env.APP_BASE_URL).origin;
  if (!host) return request.nextUrl.origin;
  return `${proto}://${host}`;
}

function redirectTo(request: NextRequest, location: string): NextResponse {
  return NextResponse.redirect(new URL(location, publicOrigin(request)));
}

export async function proxy(request: NextRequest) {  
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const payload = await verifySession(token);

  let session = null;
  let shouldClearCookie = false;
  if (payload) {
    const access = await prisma.clientAccess.findFirst({
      where: { id: payload.accessId, isActive: true },
      include: { client: true },
    });
    if (access && access.client.id === payload.clientId && access.client.isActive) {
      session = payload;
    } else {
      shouldClearCookie = true;
    }
  }

  // If the session is invalid, immediately clear the cookie.
  if (shouldClearCookie) {
    const response = pathname === "/login"
      ? NextResponse.next()
      : redirectTo(request, `${BASE_PATH}/login`);
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  // Unauthenticated health probe for nginx / load balancers / uptime monitors.
  if (pathname === "/api/health") {
    return NextResponse.next();
  }

  // Auth API endpoints are always reachable so login/logout work.
  if (pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  // /api/v1/* uses Bearer API-key authentication enforced inside each route
  // handler (verifyApiKeyHeader). The session-cookie proxy must NOT redirect
  // those requests to /login — external integrators don't have a session.
  if (pathname.startsWith("/api/v1/")) {
    return NextResponse.next();
  }

  // Public/static files under /public are served by Next from the route root
  // and must remain reachable before login, including the sidebar/login logo.
  if (/\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|txt|xml)$/i.test(pathname)) {
    return NextResponse.next();
  }

  // Login page: if already authenticated, bounce to the dashboard.
  if (pathname === "/login") {
    if (session) {
      return redirectTo(request, `${BASE_PATH}/dashboard`);
    }
    return NextResponse.next();
  }

  // Everything else requires a valid session.
  if (!session) {
    const params = new URLSearchParams();
    if (pathname !== "/") params.set("next", pathname);
    const query = params.toString();
    return redirectTo(request, `${BASE_PATH}/login${query ? `?${query}` : ""}`);
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public).*)"],
};
