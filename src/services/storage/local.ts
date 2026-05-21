import "server-only";
import path from "node:path";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import {
  AUDIO_CONTENT_TYPES,
  buildStoredAudioFileName,
  formatDateFolder,
  getAudioExtension,
  getAudioStorageRoot,
  getUniqueAudioPath,
} from "@/lib/audio-storage";
import type {
  PresignedUpload,
  SaveInput,
  StorageProvider,
  StoredObject,
} from "./types";

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local" as const;

  async save(input: SaveInput): Promise<StoredObject> {
    const dateFolder = formatDateFolder(input.date ?? new Date());
    const root = getAudioStorageRoot();
    const dayDir = path.join(root, dateFolder);
    await mkdir(dayDir, { recursive: true });

    const storedFileName = buildStoredAudioFileName(input.originalFileName);
    const absPath = await getUniqueAudioPath(dayDir, storedFileName);
    await writeFile(absPath, input.buffer);

    const ext = getAudioExtension(input.originalFileName);
    return {
      key: absPath,
      originalFileName: input.originalFileName,
      storedFileName: path.basename(absPath),
      contentType: input.contentType || AUDIO_CONTENT_TYPES[ext] || "application/octet-stream",
      sizeBytes: input.buffer.length,
      publicUrl: null,
    };
  }

  async getReadStream(key: string, opts?: { start?: number; end?: number }) {
    const info = await stat(key);
    const stream = createReadStream(key, { start: opts?.start, end: opts?.end });
    const ext = getAudioExtension(key);
    return {
      stream,
      contentType: AUDIO_CONTENT_TYPES[ext] ?? "application/octet-stream",
      sizeBytes: info.size,
    };
  }

  async getDownloadUrl(): Promise<string | null> {
    // Local files are served via the /api/calls/[id]/audio proxy route.
    return null;
  }

  async createPresignedUpload(_input: {
    originalFileName: string;
    contentType: string;
    date?: Date;
  }): Promise<PresignedUpload> {
    throw new Error("LocalStorageProvider does not support presigned uploads.");
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(key);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") throw err;
    }
  }
}
