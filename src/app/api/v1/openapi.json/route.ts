import { NextResponse } from "next/server";
import { buildOpenApiDocument } from "@/server/api/openapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public — no auth required so external integrators can fetch the schema
// before they have an API key.
export async function GET() {
  return NextResponse.json(buildOpenApiDocument());
}
