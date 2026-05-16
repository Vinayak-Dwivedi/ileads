import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { withBasePath } from "@/lib/base-path";

export const runtime = "nodejs";

export async function POST() {
  await clearSessionCookie();
  return new NextResponse(null, {
    status: 303,
    headers: { Location: withBasePath("/login") },
  });
}
