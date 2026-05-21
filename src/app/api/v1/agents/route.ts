import { appRouter } from "@/server/api";
import { withV1 } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withV1(request, async (ctx) => {
    const q = new URL(request.url).searchParams;
    return appRouter.agents.list(ctx, {
      search: q.get("search") ?? undefined,
      isActive: q.get("isActive") ?? undefined,
      take: q.get("take") ?? undefined,
      cursor: q.get("cursor") ?? undefined,
    } as never);
  });
}
