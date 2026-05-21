import { appRouter } from "@/server/api";
import { withV1 } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readFilters(request: Request) {
  const q = new URL(request.url).searchParams;
  return {
    campaignId: q.get("campaignId") ?? undefined,
    teamId: q.get("teamId") ?? undefined,
    agentId: q.get("agentId") ?? undefined,
    from: q.get("from") ?? undefined,
    to: q.get("to") ?? undefined,
  };
}

export async function GET(request: Request) {
  return withV1(request, (ctx) =>
    appRouter.dashboard.kpis(ctx, readFilters(request) as never),
  );
}
