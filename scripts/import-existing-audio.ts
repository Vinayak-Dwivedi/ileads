import { PrismaClient } from "@prisma/client";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();

const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".webm", ".aac", ".flac"]);
const MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
};

function audioRoot() {
  const configured = process.env.AUDIO_STORAGE_PATH?.trim() || "./storage/audio";
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

function externalIdFor(index: number) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const random = crypto.randomUUID().slice(0, 4).toUpperCase();
  return `CALL-IMPORT-${stamp}-${String(index + 1).padStart(2, "0")}-${random}`;
}

async function main() {
  const root = audioRoot();
  const requestedClientId = process.env.IMPORT_AUDIO_CLIENT_ID?.trim();
  const requestedClientSlug = process.env.IMPORT_AUDIO_CLIENT_SLUG?.trim();

  const client = requestedClientId
    ? await prisma.client.findFirst({ where: { id: requestedClientId, isActive: true } })
    : requestedClientSlug
      ? await prisma.client.findFirst({ where: { slug: requestedClientSlug, isActive: true } })
      : await prisma.client.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } });

  if (!client) throw new Error("No active client found for audio import.");

  const entries = await readdir(root, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort();

  let imported = 0;
  let skipped = 0;
  for (const [index, fileName] of files.entries()) {
    const audioPath = path.join(root, fileName);
    const existing = await prisma.call.findFirst({
      where: {
        clientId: client.id,
        OR: [{ storedFileName: fileName }, { audioPath }],
      },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const info = await stat(audioPath);
    const extension = path.extname(fileName).toLowerCase();
    await prisma.call.create({
      data: {
        clientId: client.id,
        externalCallId: externalIdFor(index),
        callStartedAt: info.mtime,
        status: "UNKNOWN",
        originalFileName: fileName,
        storedFileName: fileName,
        audioPath,
        mimeType: MIME_TYPES[extension] ?? "application/octet-stream",
        fileSizeBytes: BigInt(info.size),
        events: {
          create: {
            eventType: "CALL_IMPORTED",
            title: "Existing audio imported",
            description: fileName,
            payload: { storedFileName: fileName, fileSizeBytes: info.size },
          },
        },
      },
    });
    imported += 1;
  }

  console.log(
    JSON.stringify(
      {
        storagePath: root,
        clientId: client.id,
        filesFound: files.length,
        imported,
        skipped,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
