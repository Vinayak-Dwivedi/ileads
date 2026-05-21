import { appRouter } from "@/server/api";
import { withV1 } from "../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withV1(request, async (ctx) => {
    const url = new URL(request.url);
    const q = url.searchParams;
    const input = {
      search: q.get("search") ?? undefined,
      campaignId: q.get("campaignId") ?? undefined,
      teamId: q.get("teamId") ?? undefined,
      agentId: q.get("agentId") ?? undefined,
      sentiment: q.get("sentiment") ?? undefined,
      auditStatus: (q.get("auditStatus") ?? undefined) as
        | "AUDITED"
        | "PENDING"
        | "IN_REVIEW"
        | undefined,
      manualDisposition: q.get("manualDisposition") ?? undefined,
      from: q.get("from") ?? undefined,
      to: q.get("to") ?? undefined,
      take: q.get("take") ?? undefined,
      cursor: q.get("cursor") ?? undefined,
    };
    return appRouter.calls.list(ctx, input as never);
  });
}
