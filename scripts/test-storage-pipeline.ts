/**
 * Storage-pipeline test.
 *
 * Verifies the storage-provider plumbing that makes S3 (and local) audio work
 * end-to-end:
 *   A. provider.save() -> materializeAudioToLocalFile() -> read back the bytes
 *      (the path STT/ffprobe rely on).
 *   B. downloadAudioToStorage() (Excel-import path) persists remote audio
 *      through the SAME storage provider instead of writing straight to disk.
 *
 * Runs against the local provider so it needs no AWS credentials, but it
 * exercises the exact code that the S3 provider also flows through.
 *
 * Usage: npm run test:storage
 */
import "dotenv/config";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  PASS  ${msg}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${msg}`);
  }
}

async function main(): Promise<void> {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "qms-storage-test-"));

  // Force a clean, isolated local-provider config BEFORE importing the
  // modules (getStorageProvider caches on first use).
  process.env.AUDIO_STORAGE_PROVIDER = "local";
  process.env.AUDIO_STORAGE_PATH = tmpRoot;
  process.env.AUDIO_DOWNLOAD_PRIVATE_HOST_ALLOWLIST = "127.0.0.1";
  process.env.MAX_AUDIO_UPLOAD_MB = "100";

  const { getStorageProvider, materializeAudioToLocalFile } = await import(
    "../src/services/storage"
  );
  const { downloadAudioToStorage } = await import("../src/lib/audio-download");

  const payload = Buffer.from(`ID3-fake-mp3-${"x".repeat(4096)}`);

  console.log("Test A — provider.save -> materialize -> read:");
  const stored = await getStorageProvider().save({
    buffer: payload,
    originalFileName: "sample call (1).mp3",
    contentType: "audio/mpeg",
  });
  check(existsSync(stored.key), "save() wrote the object");
  check(stored.storedFileName.toLowerCase().endsWith(".mp3"), "stored name keeps .mp3 extension");
  check(stored.sizeBytes === payload.length, "reported size matches input");

  const handle = await materializeAudioToLocalFile(stored.key);
  check(existsSync(handle.path), "materialize returned a readable path");
  check(Buffer.compare(readFileSync(handle.path), payload) === 0, "materialized bytes match original");
  await handle.cleanup();

  console.log("Test B — downloadAudioToStorage routes through the provider:");
  const server = http.createServer((_req, res) => {
    res.writeHead(200, {
      "content-type": "audio/mpeg",
      "content-length": String(payload.length),
    });
    res.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/recordings/agent-1.mp3`;

  try {
    const dl = await downloadAudioToStorage(url);
    check(existsSync(dl.audioPath), "remote download persisted via provider");
    check(Buffer.compare(readFileSync(dl.audioPath), payload) === 0, "downloaded bytes match served bytes");
    check(dl.mimeType.includes("mpeg"), "mime type preserved");
    check(dl.fileSizeBytes === payload.length, "download size matches");
  } finally {
    server.close();
  }

  rmSync(tmpRoot, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll storage-pipeline checks passed.");
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
