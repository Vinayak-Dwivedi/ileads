import { appRouter } from "@/server/api";
import { withV1 } from "../../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: Params) {
  return withV1(request, async (ctx) => {
    const { id } = await params;
    return appRouter.apikeys.rotate(ctx, { id });
  });
}
