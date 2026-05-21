import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { subscribeCallEvents, type CallEvent } from "@/lib/event-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ callId: string }>;
}

const HEARTBEAT_MS = 25_000;

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(_request: Request, { params }: Params) {
  const session = await requireSession();
  const { callId } = await params;

  const call = await prisma.call.findFirst({
    where: { id: callId, clientId: session.clientId },
    select: { id: true, processingStatus: true },
  });
  if (!call) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Initial snapshot so the UI can render immediately.
      controller.enqueue(
        encoder.encode(
          sseFrame("snapshot", {
            callId: call.id,
            processingStatus: call.processingStatus,
          }),
        ),
      );

      unsubscribe = subscribeCallEvents(callId, (event: CallEvent) => {
        try {
          controller.enqueue(encoder.encode(sseFrame(event.type, event)));
        } catch {
          // Stream was closed mid-write; ignore.
        }
      });

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(sseFrame("heartbeat", { ts: Date.now() })));
        } catch {
          // ignored
        }
      }, HEARTBEAT_MS);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
