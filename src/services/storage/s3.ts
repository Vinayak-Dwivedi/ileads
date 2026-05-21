import "server-only";
import { Readable } from "node:stream";
import {
  buildStoredAudioFileName,
  formatDateFolder,
  getAudioExtension,
  AUDIO_CONTENT_TYPES,
} from "@/lib/audio-storage";
import type {
  PresignedUpload,
  SaveInput,
  StorageProvider,
  StoredObject,
} from "./types";

interface S3Config {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  publicBaseUrl?: string;
}

function readConfig(): S3Config {
  const bucket = process.env.S3_BUCKET ?? "";
  const region = process.env.S3_REGION ?? "us-east-1";
  if (!bucket) throw new Error("S3_BUCKET is required when AUDIO_STORAGE_PROVIDER=s3");
  return {
    bucket,
    region,
    endpoint: process.env.S3_ENDPOINT || undefined,
    accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
    forcePathStyle: /^true$/i.test(process.env.S3_FORCE_PATH_STYLE ?? "false"),
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || undefined,
  };
}

export class S3StorageProvider implements StorageProvider {
  readonly name = "s3" as const;
  private clientPromise: Promise<unknown> | null = null;
  private cfg: S3Config;

  constructor() {
    this.cfg = readConfig();
  }

  // Lazy SDK import so app boot doesn't pay the AWS SDK cost when running
  // in local mode.
  private async client() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { S3Client } = await import("@aws-sdk/client-s3");
        return new S3Client({
          region: this.cfg.region,
          endpoint: this.cfg.endpoint,
          forcePathStyle: this.cfg.forcePathStyle,
          credentials:
            this.cfg.accessKeyId && this.cfg.secretAccessKey
              ? {
                  accessKeyId: this.cfg.accessKeyId,
                  secretAccessKey: this.cfg.secretAccessKey,
                }
              : undefined,
        });
      })();
    }
    return this.clientPromise;
  }

  private buildKey(originalFileName: string, date?: Date): string {
    return `${formatDateFolder(date ?? new Date())}/${buildStoredAudioFileName(originalFileName)}`;
  }

  async save(input: SaveInput): Promise<StoredObject> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = (await this.client()) as InstanceType<
      typeof import("@aws-sdk/client-s3").S3Client
    >;
    const key = this.buildKey(input.originalFileName, input.date);
    await client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: input.buffer,
        ContentType: input.contentType,
      }),
    );
    return {
      key,
      originalFileName: input.originalFileName,
      storedFileName: key.split("/").pop()!,
      contentType: input.contentType,
      sizeBytes: input.buffer.length,
      publicUrl: this.cfg.publicBaseUrl
        ? `${this.cfg.publicBaseUrl.replace(/\/$/, "")}/${key}`
        : null,
    };
  }

  async getReadStream(key: string, opts?: { start?: number; end?: number }) {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = (await this.client()) as InstanceType<
      typeof import("@aws-sdk/client-s3").S3Client
    >;
    const range =
      opts?.start != null
        ? `bytes=${opts.start}-${opts.end ?? ""}`
        : undefined;
    const res = await client.send(
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key, Range: range }),
    );
    const body = res.Body as Readable | undefined;
    if (!body) throw new Error(`S3 object body missing: ${key}`);
    const ext = getAudioExtension(key);
    return {
      stream: body,
      contentType:
        res.ContentType || AUDIO_CONTENT_TYPES[ext] || "application/octet-stream",
      sizeBytes: Number(res.ContentLength ?? 0),
    };
  }

  getPublicUrl(key: string): string | null {
    if (!this.cfg.publicBaseUrl) return null;
    return `${this.cfg.publicBaseUrl.replace(/\/$/, "")}/${key}`;
  }

  async getDownloadUrl(key: string, opts?: { expiresIn?: number }): Promise<string> {
    const [{ GetObjectCommand }, { getSignedUrl }] = await Promise.all([
      import("@aws-sdk/client-s3"),
      import("@aws-sdk/s3-request-presigner"),
    ]);
    const client = (await this.client()) as InstanceType<
      typeof import("@aws-sdk/client-s3").S3Client
    >;
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }),
      { expiresIn: opts?.expiresIn ?? 900 },
    );
  }

  async createPresignedUpload(input: {
    originalFileName: string;
    contentType: string;
    date?: Date;
  }): Promise<PresignedUpload> {
    const [{ PutObjectCommand }, { getSignedUrl }] = await Promise.all([
      import("@aws-sdk/client-s3"),
      import("@aws-sdk/s3-request-presigner"),
    ]);
    const client = (await this.client()) as InstanceType<
      typeof import("@aws-sdk/client-s3").S3Client
    >;
    const key = this.buildKey(input.originalFileName, input.date);
    const expiresIn = 600;
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        ContentType: input.contentType,
      }),
      { expiresIn },
    );
    return { uploadUrl, key, expiresIn };
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = (await this.client()) as InstanceType<
      typeof import("@aws-sdk/client-s3").S3Client
    >;
    await client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}
