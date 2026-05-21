import { appRouter } from "@/server/api";
import { withV1 } from "../../_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: Params) {
  return withV1(request, async (ctx) => {
    const { id } = await params;
    return appRouter.webhooks.get(ctx, { id });
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return withV1(request, async (ctx) => {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return appRouter.webhooks.update(ctx, { ...body, id } as never);
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return withV1(request, async (ctx) => {
    const { id } = await params;
    return appRouter.webhooks.delete(ctx, { id });
  });
}
