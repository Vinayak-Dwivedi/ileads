import "server-only";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

export const ACCEPTED_AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".webm",
  ".aac",
  ".flac",
]);

export const AUDIO_CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
};

export function getAudioStorageRoot(): string {
  const configured = process.env.AUDIO_STORAGE_PATH?.trim() || "./storage/audio";
  if (path.isAbsolute(configured)) return configured;
  return path.join(/* turbopackIgnore: true */ process.cwd(), configured);
}

export function getMaxAudioUploadBytes(): number {
  const mb = Number(process.env.MAX_AUDIO_UPLOAD_MB ?? "100");
  const safeMb = Number.isFinite(mb) && mb > 0 ? mb : 100;
  return safeMb * 1024 * 1024;
}

export function getAudioExtension(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

export function sanitizeOriginalFileName(fileName: string): string {
  const base = path.basename(fileName || "audio-file");
  return base.replace(/[^\w.\- ()]+/g, "_").slice(0, 180) || "audio-file";
}

export function buildStoredAudioFileName(originalFileName: string): string {
  const extension = getAudioExtension(originalFileName);
  const timestamp = new Date()
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replaceAll(".", "")
    .replaceAll("T", "")
    .replaceAll("Z", "");
  const random = crypto.randomUUID().slice(0, 8);
  return `call-${timestamp}-${random}${extension}`;
}

export async function saveAudioFile(file: File): Promise<{
  originalFileName: string;
  storedFileName: string;
  audioPath: string;
  mimeType: string;
  fileSizeBytes: number;
}> {
  const originalFileName = sanitizeOriginalFileName(file.name);
  const extension = getAudioExtension(originalFileName);
  if (!ACCEPTED_AUDIO_EXTENSIONS.has(extension)) {
    throw new Error(`${originalFileName} is not a supported audio file.`);
  }

  const maxBytes = getMaxAudioUploadBytes();
  if (file.size > maxBytes) {
    throw new Error(`${originalFileName} exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
  }

  const storageRoot = getAudioStorageRoot();
  await mkdir(storageRoot, { recursive: true });

  const storedFileName = buildStoredAudioFileName(originalFileName);
  const audioPath = path.join(storageRoot, storedFileName);
  await writeFile(audioPath, Buffer.from(await file.arrayBuffer()));

  return {
    originalFileName,
    storedFileName,
    audioPath,
    mimeType: file.type || AUDIO_CONTENT_TYPES[extension] || "application/octet-stream",
    fileSizeBytes: file.size,
  };
}

export function contentTypeForAudioPath(audioPath: string, fallback?: string | null): string {
  if (fallback) return fallback;
  return AUDIO_CONTENT_TYPES[getAudioExtension(audioPath)] ?? "application/octet-stream";
}
