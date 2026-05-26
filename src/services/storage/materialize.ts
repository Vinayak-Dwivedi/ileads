import "server-only";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { getAudioExtension } from "@/lib/audio-storage";
import { getStorageProvider } from "./index";

export interface LocalAudioFile {
  /** Absolute path to a readable local audio file. */
  path: string;
  /**
   * Releases any temp resources created for this handle. Idempotent and safe
   * to call multiple times. Callers MUST invoke this in a finally block so
   * temp files don't leak when the provider is remote.
   */
  cleanup: () => Promise<void>;
}

const NOOP = async () => {};

/**
 * Resolve a stored audio object (identified by the Call.audioPath key) to a
 * local file path that ffprobe and the STT engines can read.
 *
 * - Local provider: the key already IS an absolute filesystem path, so it is
 *   returned as-is with a no-op cleanup.
 * - Remote providers (S3): the object is streamed to a unique temp file under
 *   the OS temp dir. The returned cleanup() removes that temp directory.
 *
 * This exists because every STT engine (Sarvam via a Python child process,
 * Deepgram via fs.readFile) and ffprobe require a real file on disk — they
 * cannot consume an S3 object key directly.
 */
export async function materializeAudioToLocalFile(key: string): Promise<LocalAudioFile> {
  const provider = getStorageProvider();
  if (provider.name === "local") {
    return { path: key, cleanup: NOOP };
  }

  const dir = await mkdtemp(path.join(tmpdir(), "qms-audio-"));
  const ext = getAudioExtension(key) || ".audio";
  const filePath = path.join(dir, `audio${ext}`);

  let removed = false;
  const cleanup = async () => {
    if (removed) return;
    removed = true;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    const { stream } = await provider.getReadStream(key);
    await pipeline(stream, createWriteStream(filePath));
  } catch (err) {
    await cleanup();
    throw err;
  }

  return { path: filePath, cleanup };
}
