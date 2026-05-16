// Base path the app is mounted under (e.g. "/ileads-qms" in production, ""
// for local dev). Set via NEXT_PUBLIC_BASE_PATH at build time — Next.js bakes
// the value into both server and client bundles, so referencing process.env
// here is safe in either runtime.
//
// Use the helper for things Next does NOT auto-prefix:
//   - raw <form action="...">
//   - NextResponse.redirect(new URL("/foo", ...)) inside middleware/proxy and
//     route handlers
//   - any hand-built absolute URL
//
// You do NOT need the helper for next/link, next/navigation's redirect(),
// next/image src values, or _next/* asset URLs — Next prepends basePath for
// those automatically.

const rawBasePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim();
export const BASE_PATH =
  rawBasePath && rawBasePath !== "/" ? rawBasePath.replace(/\/+$/, "") : "";

const DEFAULT_AUTH_REDIRECT = "/dashboard";

export function withBasePath(path: string): string {
  if (!path) return BASE_PATH || "/";
  if (!BASE_PATH) return path.startsWith("/") ? path : `/${path}`;
  // Already prefixed? Return as-is so we never produce /ileads-qms/ileads-qms/…
  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}${normalized}`;
}

function stripBasePath(path: string): string {
  if (!BASE_PATH) return path;
  if (path === BASE_PATH) return "/";
  if (path.startsWith(`${BASE_PATH}/`)) return path.slice(BASE_PATH.length) || "/";
  return path;
}

function isLocalhostUrl(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
}

function normalizeInternalPath(path: string): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return DEFAULT_AUTH_REDIRECT;
  return stripBasePath(path);
}

export function sanitizeNextPath(nextValue: string | null): string {
  if (!nextValue) return DEFAULT_AUTH_REDIRECT;
  const value = nextValue.trim();
  if (!value) return DEFAULT_AUTH_REDIRECT;

  try {
    const url = new URL(value);
    if (isLocalhostUrl(url)) return DEFAULT_AUTH_REDIRECT;

    const publicBaseUrl = process.env.APP_BASE_URL;
    if (!publicBaseUrl) return DEFAULT_AUTH_REDIRECT;

    const publicUrl = new URL(publicBaseUrl);
    if (url.origin !== publicUrl.origin) return DEFAULT_AUTH_REDIRECT;

    return normalizeInternalPath(`${url.pathname}${url.search}${url.hash}`);
  } catch {
    return normalizeInternalPath(value);
  }
}

export function buildPublicRedirect(nextValue: string | null): string {
  return withBasePath(sanitizeNextPath(nextValue));
}
