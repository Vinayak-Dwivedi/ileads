import { appRouter } from "@/server/api";
import { withV1 } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withV1(request, (ctx) => appRouter.webhooks.list(ctx, {}));
}

export async function POST(request: Request) {
  return withV1(request, async (ctx) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return appRouter.webhooks.create(ctx, body as never);
  });
}
