import "server-only";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SttError, type SttEngine, type SttResult, type SttSegment } from "../types";
import type { SttConfig } from "../config";
import {
  inferSpeakerRoles,
  type CanonicalSpeakerRole,
  type SpeakerMappingMode,
} from "@/services/transcription/inferSpeakerRoles";

interface SarvamSegment {
  start_time?: number | null;
  end_time?: number | null;
  speaker?: string | null;
  text?: string;
  confidence?: number | null;
  language?: string | null;
  channel?: string | null;
  speaker_source?: string | null;
}

interface SarvamResult {
  provider?: string;
  model?: string;
  language?: string;
  segments?: SarvamSegment[];
  raw?: Record<string, unknown>;
}

interface SarvamError {
  error: string;
  message: string;
  details?: unknown;
}

export class SarvamSttEngine implements SttEngine {
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
        "Sarvam API key missing. Add SARVAM_API_KEY in .env and restart PM2.",
      );
    }
    if (!existsSync(config.pythonBin)) {
      throw new SttError(
        "PYTHON_NOT_FOUND",
        `Python venv not found at ${config.pythonBin}. Run scripts/setup-stt-env.sh.`,
      );
    }

    const scriptPath = path.join(config.scriptDir, "transcribe_sarvam.py");
    if (!existsSync(scriptPath)) {
      throw new SttError("DEPENDENCY_MISSING", `Sarvam STT script missing: ${scriptPath}`);
    }

    mkdirSync(config.runtimeDir, { recursive: true });
    const outputPath = path.join(
      config.runtimeDir,
      `stt-sarvam-${Date.now()}-${randomUUID().slice(0, 8)}.json`,
    );

    const args = [
      scriptPath,
      "--audio",
      audioPath,
      "--api-key",
      config.sarvam.apiKey,
      "--model",
      config.sarvam.model,
      "--mode",
      config.sarvam.mode,
      "--use-batch",
      String(config.sarvam.useBatch),
      "--enable-diarization",
      String(config.sarvam.enableDiarization),
      "--poll-interval-seconds",
      String(config.sarvam.batchPollIntervalSeconds),
      "--batch-timeout-seconds",
      String(config.sarvam.batchTimeoutSeconds),
      "--output",
      outputPath,
    ];

    const timeoutSeconds = config.sarvam.useBatch
      ? config.sarvam.batchTimeoutSeconds + 120
      : config.sarvam.timeoutSeconds;
    const { stdoutText, stderrText, exitCode, timedOut } = await runChild(
      config.pythonBin,
      args,
      timeoutSeconds * 1000,
    );

    if (timedOut) {
      if (existsSync(outputPath)) {
        await unlink(outputPath).catch(() => undefined);
      }
      throw new SttError(
        "SARVAM_TIMEOUT",
        "Sarvam transcription timed out. Please retry or use a shorter audio file.",
        { stderr: stderrText.slice(-1000) },
      );
    }

    let payload: SarvamResult | SarvamError | null = null;
    try {
      const raw = existsSync(outputPath) ? await readFile(outputPath, "utf8") : stdoutText;
      payload = raw.trim() ? (JSON.parse(raw) as SarvamResult | SarvamError) : null;
    } catch (e) {
      throw new SttError("BAD_OUTPUT", `Could not parse Sarvam STT JSON output. ${(e as Error).message}`, {
        stdout: stdoutText.slice(-1000),
        stderr: stderrText.slice(-1000),
      });
    } finally {
      if (existsSync(outputPath)) {
        await unlink(outputPath).catch(() => undefined);
      }
    }

    if (payload && typeof payload === "object" && "error" in payload) {
      const err = payload as SarvamError;
      throw new SttError(mapSarvamErrorCode(err.error), safeSarvamMessage(err), err.details);
    }

    if (exitCode !== 0) {
      throw new SttError("SARVAM_TRANSCRIBE_FAILED", `Sarvam STT exited with code ${exitCode}.`, {
        stderr: stderrText.slice(-1000),
      });
    }

    if (!payload || !Array.isArray(payload.segments)) {
      throw new SttError("SARVAM_INVALID_RESPONSE", "Sarvam output missing segments array.");
    }

    const mapped = applySpeakerMapping(payload.segments, config);
    const segments: SttSegment[] = mapped.segments;

    const fullText = segments.map((s) => s.text).filter(Boolean).join(" ");
    if (!fullText) {
      throw new SttError("SARVAM_INVALID_RESPONSE", "Sarvam response did not contain usable transcript text.");
    }

    return {
      language: payload.language || "auto",
      modelUsed: payload.model || config.sarvam.model,
      provider: "sarvam",
      fullText,
      segments,
      raw: { ...(payload.raw || {}), speakerMapping: mapped.inference },
      qualityFlags: mapped.qualityFlags,
    };
  }
}

export type SarvamRawSegment = SarvamSegment;

export function applySpeakerMapping(
  inputSegments: SarvamSegment[],
  config: SttConfig,
): {
  segments: SttSegment[];
  inference: ReturnType<typeof inferSpeakerRoles>;
  qualityFlags: string[];
} {
  const effectiveMode: SpeakerMappingMode = config.sarvam.mapSpeakersToAgentCustomer
    ? config.sarvam.speakerMappingMode
    : "raw";
  const inference = inferSpeakerRoles(
    inputSegments.map((seg) => ({
      speakerId: seg.channel ?? rawSpeakerIdFromValue(seg.speaker),
      text: seg.text ?? "",
    })),
    {
      mode: effectiveMode,
      firstSpeaker: config.sarvam.firstSpeaker,
      secondSpeaker: config.sarvam.secondSpeaker,
    },
  );

  const source =
    effectiveMode === "raw"
      ? "sarvam_diarization_raw"
      : effectiveMode === "fixed" || inference.confidence === "low"
        ? "sarvam_diarization_mapped"
        : "sarvam_diarization_heuristic";

  const segments: SttSegment[] = inputSegments.map((seg) => {
    const rawSpeakerId = rawSpeakerIdFromValue(seg.channel ?? seg.speaker);
    const role = rawSpeakerId ? inference.mapping[rawSpeakerId] : "unknown";
    return {
      speaker: mapCanonicalRole(role),
      startMs: Math.max(0, Math.round((seg.start_time ?? 0) * 1000)),
      endMs:
        typeof seg.end_time === "number"
          ? Math.max(0, Math.round(seg.end_time * 1000))
          : Math.max(0, Math.round((seg.start_time ?? 0) * 1000)),
      text: (seg.text ?? "").trim(),
      confidenceScore: typeof seg.confidence === "number" ? seg.confidence : null,
      channel: rawSpeakerId,
      speakerSource: rawSpeakerId ? source : (seg.speaker_source ?? "sarvam_no_diarization"),
    };
  });

  return {
    segments,
    inference,
    qualityFlags: [
      `speaker_mapping_mode_${effectiveMode}`,
      `speaker_mapping_confidence_${inference.confidence}`,
    ],
  };
}

function rawSpeakerIdFromValue(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw || raw === "unknown" || raw === "agent" || raw === "customer" || raw === "system") return null;
  return raw
    .replace(/^speaker[_\s-]?/, "")
    .replace(/^spk[_\s-]?/, "")
    .trim();
}

function mapCanonicalRole(value: CanonicalSpeakerRole | undefined): SttSegment["speaker"] {
  if (value === "agent") return "AGENT";
  if (value === "customer") return "CUSTOMER";
  return "UNKNOWN";
}

function mapSarvamErrorCode(code: string): SttError["code"] {
  switch (code) {
    case "SARVAM_API_KEY_MISSING":
      return "SARVAM_API_KEY_MISSING";
    case "SARVAM_TIMEOUT":
      return "SARVAM_TIMEOUT";
    case "SARVAM_BATCH_FAILED":
      return "SARVAM_BATCH_FAILED";
    case "SARVAM_HTTP_ERROR":
      return "SARVAM_HTTP_ERROR";
    case "SARVAM_INVALID_RESPONSE":
      return "SARVAM_INVALID_RESPONSE";
    case "AUDIO_NOT_FOUND":
      return "AUDIO_NOT_FOUND";
    case "DEPENDENCY_MISSING":
      return "DEPENDENCY_MISSING";
    default:
      return "SARVAM_TRANSCRIBE_FAILED";
  }
}

function safeSarvamMessage(err: SarvamError): string {
  if (err.error === "SARVAM_API_KEY_MISSING") {
    return "Sarvam API key missing. Add SARVAM_API_KEY in .env and restart PM2.";
  }
  if (err.error === "SARVAM_TIMEOUT") {
    return "Sarvam transcription timed out. Please retry or use a shorter audio file.";
  }
  if (err.error === "SARVAM_BATCH_FAILED") return "Sarvam batch transcription failed. Please retry.";
  if (err.error === "SARVAM_HTTP_ERROR") return "Sarvam transcription request failed. Please retry.";
  if (err.error === "SARVAM_INVALID_RESPONSE") return err.message || "Sarvam returned an invalid response.";
  return err.message || "Sarvam transcription failed.";
}

interface ChildResult {
  stdoutText: string;
  stderrText: string;
  exitCode: number;
  timedOut: boolean;
}

function runChild(bin: string, args: string[], timeoutMs: number): Promise<ChildResult> {
  return new Promise((resolve) => {
    let stdoutText = "";
    let stderrText = "";
    let timedOut = false;
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, Math.max(1000, timeoutMs));

    child.stdout.on("data", (chunk) => {
      stdoutText += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderrText += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdoutText,
        stderrText: stderrText + `\n[node:spawn] ${err.message}`,
        exitCode: 127,
        timedOut,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdoutText, stderrText, exitCode: code ?? -1, timedOut });
    });
  });
}
