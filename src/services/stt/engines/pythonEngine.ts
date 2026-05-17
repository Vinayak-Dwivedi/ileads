import "server-only";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SttError, type SttEngine, type SttResult, type SttSegment } from "../types";
import type { SttConfig, SttModelConfig } from "../config";

interface PythonSegment {
  segment_id?: string;
  start_time?: number;
  end_time?: number;
  speaker?: string | null;
  text?: string;
  confidence?: number | null;
  language?: string;
  model?: string;
  channel?: string | null;
  speaker_source?: string;
  raw?: Record<string, unknown>;
}

interface PythonResult {
  provider?: string;
  model?: string;
  language?: string;
  segments?: PythonSegment[];
  raw?: Record<string, unknown>;
}

interface PythonError {
  error: string;
  message: string;
  details?: unknown;
}

export interface PythonEngineOptions {
  modelConfig: SttModelConfig;
  config: SttConfig;
  /** Optional override; defaults to transcribe.py (unified). */
  scriptName?: string;
}

export class PythonSttEngine implements SttEngine {
  readonly name: string;
  private readonly opts: PythonEngineOptions;

  constructor(opts: PythonEngineOptions) {
    this.opts = opts;
    this.name = opts.modelConfig.key;
  }

  async transcribe(audioPath: string): Promise<SttResult> {
    const { config, modelConfig } = this.opts;
    const scriptName = this.opts.scriptName ?? "transcribe.py";

    if (!existsSync(audioPath)) {
      throw new SttError("AUDIO_NOT_FOUND", `Audio file does not exist: ${audioPath}`);
    }
    if (!existsSync(config.pythonBin)) {
      throw new SttError(
        "PYTHON_NOT_FOUND",
        `Python venv not found at ${config.pythonBin}. Run scripts/setup-stt-env.sh.`,
      );
    }
    const scriptPath = path.join(config.scriptDir, scriptName);
    if (!existsSync(scriptPath)) {
      throw new SttError("DEPENDENCY_MISSING", `STT script missing: ${scriptPath}`);
    }

    mkdirSync(config.runtimeDir, { recursive: true });
    const outputPath = path.join(
      config.runtimeDir,
      `stt-${modelConfig.key}-${Date.now()}-${randomUUID().slice(0, 8)}.json`,
    );

    const args = [
      scriptPath,
      "--audio",
      audioPath,
      "--model-key",
      modelConfig.key,
      "--model-path",
      modelConfig.modelPath,
      "--language",
      modelConfig.language,
      "--device",
      modelConfig.device,
      "--chunk-seconds",
      String(config.chunkSeconds),
      "--chunk-overlap-seconds",
      String(config.chunkOverlapSeconds),
      "--output",
      outputPath,
    ];

    const { stdoutText, stderrText, exitCode, timedOut } = await runChild(
      config.pythonBin,
      args,
      config.timeoutSeconds * 1000,
    );

    let payload: PythonResult | PythonError | null = null;
    try {
      const raw = existsSync(outputPath) ? await readFile(outputPath, "utf8") : stdoutText;
      payload = raw.trim() ? (JSON.parse(raw) as PythonResult | PythonError) : null;
    } catch (e) {
      throw new SttError("BAD_OUTPUT", `Could not parse STT JSON output. ${(e as Error).message}`, {
        stdout: stdoutText.slice(-1000),
        stderr: stderrText.slice(-1000),
      });
    } finally {
      if (existsSync(outputPath)) {
        await unlink(outputPath).catch(() => undefined);
      }
    }

    if (timedOut) {
      throw new SttError("TIMEOUT", `STT subprocess exceeded ${config.timeoutSeconds}s.`);
    }

    if (payload && typeof payload === "object" && "error" in payload) {
      const err = payload as PythonError;
      const code = mapPythonErrorCode(err.error);
      throw new SttError(code, err.message || err.error || "Unknown STT failure.", err.details);
    }

    if (exitCode !== 0) {
      throw new SttError("TRANSCRIBE_FAILED", `STT subprocess exited with code ${exitCode}.`, {
        stderr: stderrText.slice(-1000),
      });
    }

    if (!payload || !Array.isArray(payload.segments)) {
      throw new SttError("BAD_OUTPUT", "STT output missing segments array.");
    }

    const segments: SttSegment[] = payload.segments.map((seg) => ({
      speaker: mapSpeaker(seg.speaker),
      startMs: Math.max(0, Math.round((seg.start_time ?? 0) * 1000)),
      endMs: Math.max(0, Math.round((seg.end_time ?? 0) * 1000)),
      text: (seg.text ?? "").trim(),
      confidenceScore: typeof seg.confidence === "number" ? seg.confidence : null,
      channel: seg.channel ?? null,
      speakerSource: seg.speaker_source ?? "unknown",
    }));

    const fullText = segments.map((s) => s.text).filter(Boolean).join(" ");

    return {
      language: payload.language || modelConfig.language,
      modelUsed: payload.model || modelConfig.key,
      provider: payload.provider || modelConfig.provider,
      fullText,
      segments,
      raw: payload.raw || {},
    };
  }
}

function mapSpeaker(value: string | null | undefined): SttSegment["speaker"] {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "agent") return "AGENT";
  if (v === "customer") return "CUSTOMER";
  if (v === "system") return "SYSTEM";
  return "UNKNOWN";
}

function mapPythonErrorCode(code: string): SttError["code"] {
  switch (code) {
    case "AUDIO_NOT_FOUND":
      return "AUDIO_NOT_FOUND";
    case "MODEL_NOT_FOUND":
    case "MODEL_FILE_MISSING":
      return "MODEL_NOT_FOUND";
    case "DEPENDENCY_MISSING":
    case "FFMPEG_MISSING":
      return "DEPENDENCY_MISSING";
    case "NOT_IMPLEMENTED":
      return "NOT_IMPLEMENTED";
    default:
      return "TRANSCRIBE_FAILED";
  }
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
      resolve({
        stdoutText,
        stderrText,
        exitCode: code ?? -1,
        timedOut,
      });
    });
  });
}
