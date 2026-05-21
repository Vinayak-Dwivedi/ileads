import { NextResponse } from "next/server";
import { Readable } from "node:stream";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStorageProvider } from "@/services/storage";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ callId: string }>;
}

export async function GET(request: Request, { params }: Params) {
  const session = await requireSession();
  const { callId } = await params;
  const call = await prisma.call.findFirst({
    where: { id: callId, clientId: session.clientId },
    select: { audioPath: true, mimeType: true, originalFileName: true },
  });

  if (!call?.audioPath) {
    return NextResponse.json({ error: "Audio not found." }, { status: 404 });
  }

  const provider = getStorageProvider();

  // Prefer a CDN-fronted public URL when the provider exposes one — skips
  // both the Next proxy and the presign roundtrip, and plays nicely with
  // edge caches.
  const publicUrl = provider.getPublicUrl(call.audioPath);
  if (publicUrl) return NextResponse.redirect(publicUrl, 302);

  // Otherwise: presigned download for remote providers (S3), proxied stream
  // for local.
  if (provider.name !== "local") {
    const url = await provider.getDownloadUrl(call.audioPath, { expiresIn: 900 });
    if (url) return NextResponse.redirect(url, 302);
  }

  // Local provider: stream from disk with HTTP Range support.
  const range = request.headers.get("range");
  const safeName = encodeURIComponent(call.originalFileName ?? "call-audio");

  let info;
  try {
    info = await provider.getReadStream(call.audioPath);
  } catch {
    return NextResponse.json({ error: "Audio file is missing from storage." }, { status: 404 });
  }

  const contentType = call.mimeType ?? info.contentType;

  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : info.sizeBytes - 1;
      if (start < info.sizeBytes && end < info.sizeBytes && start <= end) {
        const part = await provider.getReadStream(call.audioPath, { start, end });
        return new NextResponse(
          Readable.toWeb(part.stream) as ReadableStream<Uint8Array>,
          {
            status: 206,
            headers: {
              "Accept-Ranges": "bytes",
              "Content-Range": `bytes ${start}-${end}/${info.sizeBytes}`,
              "Content-Length": String(end - start + 1),
              "Content-Type": contentType,
              "Content-Disposition": `inline; filename*=UTF-8''${safeName}`,
            },
          },
        );
      }
    }
  }

  return new NextResponse(Readable.toWeb(info.stream) as ReadableStream<Uint8Array>, {
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(info.sizeBytes),
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename*=UTF-8''${safeName}`,
    },
  });
}
