import { NextResponse } from "next/server";
import { verifyApiKeyHeader } from "@/lib/api-key";
import { buildApiKeyContext } from "@/server/api";
import { ApiError } from "@/server/api";
import { checkApiKeyRateLimit, recordApiKeyHit } from "@/lib/rate-limit";

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

// Serialise BigInt safely for JSON responses.
function jsonSafe<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as T;
}

export async function withV1<T>(
  request: Request,
  run: (ctx: Awaited<ReturnType<typeof buildContext>>) => Promise<T>,
): Promise<Response> {
  try {
    const ctx = await buildContext(request);
    const data = await run(ctx);
    return NextResponse.json(jsonSafe({ data }));
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message, details: err.details } },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL", message: "Unexpected error." } },
      { status: 500 },
    );
  }
}

async function buildContext(request: Request) {
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent") ?? undefined;

  const verified = await verifyApiKeyHeader(request.headers.get("authorization"));

  const limit = checkApiKeyRateLimit(verified.prefix);
  if (!limit.allowed) {
    const err = new ApiError(
      "RATE_LIMITED",
      "Rate limit exceeded. Retry later.",
    );
    // Attach Retry-After via a thrown Response is hard with the current
    // shape; clients should respect a `Retry-After` header which we add here
    // by wrapping the throw. For now surface it in details.
    (err as ApiError & { retryAfterMs: number }).retryAfterMs = limit.retryAfterMs;
    throw err;
  }
  recordApiKeyHit(verified.prefix);

  return buildApiKeyContext({
    clientId: verified.clientId,
    apiKeyPrefix: verified.prefix,
    createdByUserId: verified.createdByUserId ?? undefined,
    scopes: verified.scopes,
    ip,
    userAgent,
  });
}
