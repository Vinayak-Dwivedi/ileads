import "server-only";
import type { Readable } from "node:stream";

export type StorageProviderName = "local" | "s3";

export interface SaveInput {
  buffer: Buffer;
  originalFileName: string;
  contentType: string;
  // Used to organise objects into per-day folders.
  date?: Date;
}

export interface StoredObject {
  // Opaque handle that the same provider can use to look the object back up.
  // For LocalProvider this is the absolute filesystem path. For S3Provider
  // this is the bucket-scoped object key.
  key: string;
  originalFileName: string;
  storedFileName: string;
  contentType: string;
  sizeBytes: number;
  // Public URL that browsers/players can hit directly. null when the provider
  // requires server-side proxying (LocalProvider).
  publicUrl?: string | null;
}

export interface PresignedUpload {
  uploadUrl: string;
  // Header/field bag the client must send with the upload request.
  fields?: Record<string, string>;
  // The key the object will live at after the upload completes.
  key: string;
  // Seconds until the presigned URL expires.
  expiresIn: number;
}

export interface StorageProvider {
  readonly name: StorageProviderName;

  // Synchronous server-side save (small files, server-mediated uploads).
  save(input: SaveInput): Promise<StoredObject>;

  // Read the object back as a Node stream. Optional byte range for HTTP Range
  // support on the audio download endpoint.
  getReadStream(key: string, opts?: { start?: number; end?: number }): Promise<{
    stream: Readable;
    contentType: string;
    sizeBytes: number;
  }>;

  // Get a signed URL the browser can hit directly. Returns null for providers
  // that don't support presigned downloads (LocalProvider) — caller must
  // proxy via /api/calls/[id]/audio.
  getDownloadUrl(key: string, opts?: { expiresIn?: number }): Promise<string | null>;

  // Get a presigned URL the browser can POST/PUT to for direct uploads.
  // Throws if unsupported (LocalProvider).
  createPresignedUpload(input: {
    originalFileName: string;
    contentType: string;
    date?: Date;
  }): Promise<PresignedUpload>;

  delete(key: string): Promise<void>;
}
