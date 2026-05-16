import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { contentTypeForAudioPath } from "@/lib/audio-storage";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ callId: string }>;
}

function streamFile(path: string, start?: number, end?: number): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
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

  let info;
  try {
    info = await stat(call.audioPath);
  } catch {
    return NextResponse.json({ error: "Audio file is missing from storage." }, { status: 404 });
  }

  const contentType = contentTypeForAudioPath(call.audioPath, call.mimeType);
  const range = request.headers.get("range");
  const safeName = encodeURIComponent(call.originalFileName ?? "call-audio");

  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : info.size - 1;
      if (start < info.size && end < info.size && start <= end) {
        return new NextResponse(streamFile(call.audioPath, start, end), {
          status: 206,
          headers: {
            "Accept-Ranges": "bytes",
            "Content-Range": `bytes ${start}-${end}/${info.size}`,
            "Content-Length": String(end - start + 1),
            "Content-Type": contentType,
            "Content-Disposition": `inline; filename*=UTF-8''${safeName}`,
          },
        });
      }
    }
  }

  return new NextResponse(streamFile(call.audioPath), {
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(info.size),
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename*=UTF-8''${safeName}`,
    },
  });
}
