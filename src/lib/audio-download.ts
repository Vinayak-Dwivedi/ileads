import "server-only";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { lookup as dnsLookup } from "node:dns/promises";
import {
  ACCEPTED_AUDIO_EXTENSIONS,
  AUDIO_CONTENT_TYPES,
  buildStoredAudioFileName,
  formatDateFolder,
  getAudioExtension,
  getAudioStorageRoot,
  getMaxAudioUploadBytes,
  getUniqueAudioPath,
  sanitizeOriginalFileName,
} from "@/lib/audio-storage";

export interface DownloadResult {
  originalFileName: string;
  storedFileName: string;
  audioPath: string;
  mimeType: string;
  fileSizeBytes: number;
  sourceUrl: string;
}

export class AudioDownloadError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AudioDownloadError";
    this.code = code;
  }
}

function getDownloadTimeoutMs(): number {
  const v = Number(process.env.AUDIO_DOWNLOAD_TIMEOUT_SECONDS ?? "300");
  return Number.isFinite(v) && v > 0 ? v * 1000 : 300_000;
}

function getPrivateHostAllowlist(): Set<string> {
  const raw = process.env.AUDIO_DOWNLOAD_PRIVATE_HOST_ALLOWLIST ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isIpv4Private(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
}

function isIpv6Private(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80:")) return true;
  if (lower === "::") return true;
  return false;
}

async function validateUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AudioDownloadError("INVALID_URL", `Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AudioDownloadError(
      "INVALID_PROTOCOL",
      `Unsupported protocol ${url.protocol}. Only http/https allowed.`,
    );
  }

  const host = url.hostname.toLowerCase();
  const allowlist = getPrivateHostAllowlist();
  if (allowlist.has(host)) return url;

  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") {
    throw new AudioDownloadError("PRIVATE_HOST", "Localhost URLs are not allowed.");
  }
  // Resolve all DNS entries and reject any private/loopback addresses.
  try {
    const addresses = await dnsLookup(host, { all: true });
    for (const a of addresses) {
      const blocked = a.family === 6 ? isIpv6Private(a.address) : isIpv4Private(a.address);
      if (blocked) {
        throw new AudioDownloadError(
          "PRIVATE_HOST",
          `Refusing to download from private/loopback address (${a.address}).`,
        );
      }
    }
  } catch (e) {
    if (e instanceof AudioDownloadError) throw e;
    throw new AudioDownloadError(
      "DNS_FAILURE",
      `Could not resolve hostname: ${host}`,
    );
  }
  return url;
}

function deriveFileNameFromUrl(url: URL, contentType: string | null): string {
  const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const decoded = (() => {
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  })();
  const sanitized = sanitizeOriginalFileName(decoded || "remote-call");
  const ext = getAudioExtension(sanitized);
  if (ACCEPTED_AUDIO_EXTENSIONS.has(ext)) return sanitized;

  // Fall back to deriving from content type
  const guess = guessExtensionFromContentType(contentType);
  return sanitizeOriginalFileName(`${path.basename(sanitized, ext) || "remote-call"}${guess}`);
}

function guessExtensionFromContentType(ct: string | null): string {
  if (!ct) return ".mp3";
  const lower = ct.toLowerCase();
  if (lower.includes("mpeg")) return ".mp3";
  if (lower.includes("wav")) return ".wav";
  if (lower.includes("mp4") || lower.includes("m4a") || lower.includes("aac")) return ".m4a";
  if (lower.includes("ogg")) return ".ogg";
  if (lower.includes("webm")) return ".webm";
  if (lower.includes("flac")) return ".flac";
  return ".mp3";
}

/**
 * Download an audio file from a remote http(s) URL to local storage under
 * the configured AUDIO_STORAGE_PATH/<YYYY-MM-DD>/ folder.
 * Validates URL protocol + SSRF (private/loopback hosts blocked unless
 * AUDIO_DOWNLOAD_ALLOWED_PRIVATE_HOSTS=true).
 */
export async function downloadAudioToStorage(
  rawUrl: string,
  opts: { date?: Date } = {},
): Promise<DownloadResult> {
  const url = await validateUrl(rawUrl);
  const maxBytes = getMaxAudioUploadBytes();
  const timeoutMs = getDownloadTimeoutMs();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name === "AbortError") {
      throw new AudioDownloadError("TIMEOUT", `Download timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw new AudioDownloadError(
      "FETCH_FAILED",
      `Could not download: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    throw new AudioDownloadError(
      "HTTP_ERROR",
      `HTTP ${response.status} fetching audio.`,
    );
  }

  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const cl = Number(contentLengthHeader);
    if (Number.isFinite(cl) && cl > maxBytes) {
      throw new AudioDownloadError(
        "TOO_LARGE",
        `Audio is ${Math.round(cl / 1024 / 1024)} MB, exceeds limit of ${Math.round(maxBytes / 1024 / 1024)} MB.`,
      );
    }
  }

  const contentType = response.headers.get("content-type");
  const buf = Buffer.from(await response.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new AudioDownloadError(
      "TOO_LARGE",
      `Audio is ${Math.round(buf.length / 1024 / 1024)} MB, exceeds limit of ${Math.round(maxBytes / 1024 / 1024)} MB.`,
    );
  }
  if (buf.length === 0) {
    throw new AudioDownloadError("EMPTY", "Download returned 0 bytes.");
  }

  const originalFileName = deriveFileNameFromUrl(url, contentType);
  const extension = getAudioExtension(originalFileName);
  if (!ACCEPTED_AUDIO_EXTENSIONS.has(extension)) {
    throw new AudioDownloadError(
      "UNSUPPORTED_TYPE",
      `Unsupported audio extension: ${extension || "(none)"}.`,
    );
  }

  const dateFolder = formatDateFolder(opts.date ?? new Date());
  const storageRoot = getAudioStorageRoot();
  const dayDir = path.join(storageRoot, dateFolder);
  await mkdir(dayDir, { recursive: true });

  const storedFileName = buildStoredAudioFileName(originalFileName);
  const audioPath = await getUniqueAudioPath(dayDir, storedFileName);
  await writeFile(audioPath, buf);

  return {
    originalFileName,
    storedFileName: path.basename(audioPath),
    audioPath,
    mimeType: contentType?.split(";")[0]?.trim() || AUDIO_CONTENT_TYPES[extension] || "application/octet-stream",
    fileSizeBytes: buf.length,
    sourceUrl: url.toString(),
  };
}
