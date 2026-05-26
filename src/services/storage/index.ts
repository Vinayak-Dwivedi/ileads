import "server-only";
import { LocalStorageProvider } from "./local";
import { S3StorageProvider } from "./s3";
import type { StorageProvider } from "./types";

export type { StorageProvider, StoredObject, PresignedUpload, SaveInput } from "./types";
export { materializeAudioToLocalFile, type LocalAudioFile } from "./materialize";

let cached: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cached) return cached;
  const choice = (process.env.AUDIO_STORAGE_PROVIDER ?? "local").toLowerCase();
  switch (choice) {
    case "s3":
      cached = new S3StorageProvider();
      return cached;
    case "local":
    default:
      cached = new LocalStorageProvider();
      return cached;
  }
}

// For tests / restart hooks.
export function resetStorageProvider(): void {
  cached = null;
}
