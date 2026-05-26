import "server-only";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SttError, type SttEngine, type SttResult } from "../types";
import type { SttConfig } from "../config";
import { applySpeakerMapping, type SarvamRawSegment } from "./sarvamEngine";

// Native (no-Python) Sarvam STT engine built on the official `sarvamai` Node
// SDK. Uses the Batch (job) API — the only Sarvam STT surface that supports
// diarization and audio longer than ~30s, which is what QC call recordings
// need. The flow mirrors the legacy Python adapter exactly:
//   createJob -> uploadFiles -> start -> waitUntilComplete -> downloadOutputs
// then we parse the per-file JSON and reuse applySpeakerMapping() so the
// downstream transcript/speaker behaviour is identical to before.

interface DiarizedEntry {
  transcript?: string;
  start_time_seconds?: number | null;
  end_time_seconds?: number | null;
  speaker_id?: string | null;
}

interface SarvamBatchOutput {
  request_id?: string | null;
  transcript?: string | null;
  language_code?: string | null;
  language_probability?: number | null;
  diarized_transcript?: { entries?: DiarizedEntry[] | null } | null;
}

export class SarvamSdkSttEngine implements SttEngine {
  readonly name = "sarvam";
  private readonly config: SttConfig;

  constructor(config: SttConfig) {
    this.config = config;
  }

  async transcribe(audioPath: string): Promise<SttResult> {
    const { config } = this;
    if (!existsSync(audioPath)) {
      throw new SttError("AUDIO_NOT_FOUND", `Audio file does not exist: ${audioPath}`);
    }
    if (!config.sarvam.apiKey) {
      throw new SttError(
        "SARVAM_API_KEY_MISSING",
        "Sarvam API key missing. Add SARVAM_API_KEY in .env and restart the worker.",
      );
    }

    const { SarvamAIClient } = await import("sarvamai");
    const client = new SarvamAIClient({ apiSubscriptionKey: config.sarvam.apiKey });

    const languageCode = (process.env.SARVAM_LANGUAGE_CODE ?? "").trim();
    const isSaaras = config.sarvam.model.toLowerCase().startsWith("saaras");

    let outputDir: string | null = null;
    try {
      const job = await client.speechToTextJob.createJob({
        model: config.sarvam.model as never,
        withDiarization: config.sarvam.enableDiarization,
        withTimestamps: true,
        numSpeakers: 2,
        // `mode` is only meaningful for saaras:v3; omit it otherwise.
        ...(isSaaras ? { mode: config.sarvam.mode as never } : {}),
        ...(languageCode ? { languageCode: languageCode as never } : {}),
      });

      const uploaded = await job.uploadFiles([audioPath], 120);
      if (!uploaded) {
        throw new SttError("SARVAM_BATCH_FAILED", "Sarvam batch upload failed.");
      }

      await job.start();

      try {
        await job.waitUntilComplete(
          config.sarvam.batchPollIntervalSeconds,
          config.sarvam.batchTimeoutSeconds,
        );
      } catch (e) {
        throw new SttError(
          "SARVAM_TIMEOUT",
          "Sarvam transcription timed out. Please retry or use a shorter audio file.",
          { message: e instanceof Error ? e.message : String(e) },
        );
      }

      const results = await job.getFileResults();
      if (results.successful.length === 0) {
        const reason = results.failed[0]?.error_message || "Sarvam batch job failed.";
        throw new SttError("SARVAM_BATCH_FAILED", reason);
      }

      outputDir = await mkdtemp(path.join(tmpdir(), "sarvam-batch-out-"));
      await job.downloadOutputs(outputDir);
      const output = await readFirstJson(outputDir);

      const rawSegments = toRawSegments(output);
      if (rawSegments.length === 0) {
        throw new SttError(
          "SARVAM_INVALID_RESPONSE",
          "Sarvam response did not contain usable transcript text.",
        );
      }

      const mapped = applySpeakerMapping(rawSegments, config);
      const fullText = mapped.segments.map((s) => s.text).filter(Boolean).join(" ");
      if (!fullText) {
        throw new SttError(
          "SARVAM_INVALID_RESPONSE",
          "Sarvam response did not contain usable transcript text.",
        );
      }

      return {
        language: output.language_code || "auto",
        modelUsed: config.sarvam.model,
        provider: "sarvam",
        fullText,
        segments: mapped.segments,
        raw: { speakerMapping: mapped.inference, response: output as Record<string, unknown> },
        qualityFlags: mapped.qualityFlags,
      };
    } catch (e) {
      if (e instanceof SttError) throw e;
      const message = e instanceof Error ? e.message : String(e);
      const code = /timed?\s*out|timeout/i.test(message)
        ? "SARVAM_TIMEOUT"
        : "SARVAM_HTTP_ERROR";
      throw new SttError(code, `Sarvam transcription failed: ${message}`);
    } finally {
      if (outputDir) {
        await rm(outputDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}

/** Read the first *.json output file the SDK downloaded for our single input. */
async function readFirstJson(dir: string): Promise<SarvamBatchOutput> {
  const files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(".json")).sort();
  if (files.length === 0) {
    throw new SttError(
      "SARVAM_INVALID_RESPONSE",
      "Sarvam batch completed but no JSON output file was downloaded.",
    );
  }
  const raw = await readFile(path.join(dir, files[0]), "utf8");
  try {
    return JSON.parse(raw) as SarvamBatchOutput;
  } catch (e) {
    throw new SttError(
      "SARVAM_INVALID_RESPONSE",
      `Could not parse Sarvam output JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Convert Sarvam's batch output into the raw-segment shape that
 * applySpeakerMapping() expects. Prefers the diarized transcript; falls back
 * to the flat transcript as a single segment.
 */
function toRawSegments(output: SarvamBatchOutput): SarvamRawSegment[] {
  const entries = output.diarized_transcript?.entries ?? [];
  const segments: SarvamRawSegment[] = [];
  for (const entry of entries) {
    const text = (entry.transcript ?? "").trim();
    if (!text) continue;
    segments.push({
      start_time: entry.start_time_seconds ?? 0,
      end_time: entry.end_time_seconds ?? null,
      speaker: entry.speaker_id ?? null,
      text,
      confidence: null,
      channel: null,
    });
  }
  if (segments.length === 0) {
    const flat = (output.transcript ?? "").trim();
    if (flat) {
      segments.push({
        start_time: 0,
        end_time: null,
        speaker: null,
        text: flat,
        confidence: null,
        channel: null,
      });
    }
  }
  return segments;
}
