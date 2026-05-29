import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Unauthenticated liveness/readiness probe for nginx, load balancers (ALB),
// and uptime monitors. Returns 200 when the app is up and Postgres answers a
// trivial query, 503 when the DB is unreachable. Exposes no secrets and needs
// no session — `src/proxy.ts` whitelists this path before the auth gate.
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      db: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      latencyMs: Date.now() - startedAt,
    });
  } catch {
    return NextResponse.json(
      { status: "error", db: "unreachable" },
      { status: 503 },
    );
  }
}
