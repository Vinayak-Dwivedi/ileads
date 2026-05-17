import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  inferSpeakerRoles,
  type CanonicalSpeakerRole,
  type SpeakerMappingMode,
} from "../src/services/transcription/inferSpeakerRoles";

interface SarvamOutputSegment {
  start_time?: number | null;
  end_time?: number | null;
  speaker?: string | null;
  text?: string;
  channel?: string | null;
}

interface SarvamOutput {
  segments?: SarvamOutputSegment[];
}

interface CalibrationResult {
  file: string;
  clip: string;
  segmentCount: number;
  mapping: Record<string, CanonicalSpeakerRole>;
  confidence: string;
  reason: string;
  segments: Array<{
    timestamp: string;
    rawSpeaker: string;
    mappedSpeaker: CanonicalSpeakerRole;
    text: string;
  }>;
}

const repoRoot = process.cwd();
const audioRoot = path.join(repoRoot, "storage", "audio");
const runtimeRoot = path.join(repoRoot, "runtime", "stt");
const saveReport = process.argv.includes("--save");

function main() {
  if (!process.env.SARVAM_API_KEY?.trim()) {
    throw new Error("SARVAM_API_KEY is missing. Add it to .env before running calibration.");
  }

  mkdirSync(runtimeRoot, { recursive: true });
  const files = pickAudioFiles();
  if (files.length === 0) throw new Error(`No audio files found in ${audioRoot}`);

  const results: CalibrationResult[] = [];
  for (const [index, file] of files.entries()) {
    const clip = path.join(runtimeRoot, `speaker-calibration-${index + 1}.wav`);
    createClip(file, clip);
    const output = runSarvamBatch(clip, index + 1);
    const segments = output.segments ?? [];
    const inference = inferSpeakerRoles(
      segments.map((segment) => ({
        speakerId: segment.channel ?? segment.speaker,
        text: segment.text ?? "",
      })),
      {
        mode: envMappingMode(),
        firstSpeaker: envSpeaker("SARVAM_FIRST_SPEAKER", "agent"),
        secondSpeaker: envSpeaker("SARVAM_SECOND_SPEAKER", "customer"),
      },
    );

    const printable = segments.map((segment) => {
      const raw = normalizeRawSpeaker(segment.channel ?? segment.speaker);
      return {
        timestamp: `${fmt(segment.start_time)}-${fmt(segment.end_time)}`,
        rawSpeaker: raw ?? "unknown",
        mappedSpeaker: raw ? inference.mapping[raw] ?? "unknown" : "unknown",
        text: (segment.text ?? "").replace(/\s+/g, " ").trim(),
      };
    });

    const result: CalibrationResult = {
      file,
      clip,
      segmentCount: segments.length,
      mapping: inference.mapping,
      confidence: inference.confidence,
      reason: inference.reason,
      segments: printable,
    };
    results.push(result);
    printResult(result);
  }

  if (saveReport) {
    const reportPath = path.join(runtimeRoot, "speaker-calibration-report.json");
    writeFileSync(reportPath, JSON.stringify(results, null, 2), "utf8");
    console.log(`\nSaved report: ${reportPath}`);
  }
}

function pickAudioFiles(): string[] {
  return readdirSync(audioRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(audioRoot, entry.name))
    .filter((file) => /\.(wav|mp3|m4a|aac|flac|ogg|webm)$/i.test(file))
    .map((file) => ({ file, size: statSync(file).size }))
    .filter((entry) => entry.size > 1024)
    .sort((a, b) => a.size - b.size)
    .slice(0, 5)
    .map((entry) => entry.file);
}

function createClip(input: string, output: string) {
  const ffmpeg = spawnSync(
    "ffmpeg",
    ["-y", "-i", input, "-t", "60", "-ac", "1", "-ar", "16000", output],
    { encoding: "utf8" },
  );
  if (ffmpeg.status !== 0 || !existsSync(output)) {
    throw new Error(`ffmpeg failed for ${path.basename(input)}: ${ffmpeg.stderr.slice(-500)}`);
  }
}

function runSarvamBatch(audio: string, index: number): SarvamOutput {
  const outputPath = path.join(runtimeRoot, `speaker-calibration-${index}.json`);
  const pythonBin = process.env.STT_PYTHON_BIN || path.join(repoRoot, ".venv-stt", "bin", "python");
  const scriptPath = path.join(repoRoot, "stt", "transcribe_sarvam.py");
  const run = spawnSync(
    pythonBin,
    [
      scriptPath,
      "--audio",
      audio,
      "--model",
      process.env.SARVAM_STT_MODEL || "saaras:v3",
      "--mode",
      process.env.SARVAM_STT_MODE || "transcribe",
      "--use-batch",
      "true",
      "--enable-diarization",
      "true",
      "--poll-interval-seconds",
      process.env.SARVAM_BATCH_POLL_INTERVAL_SECONDS || "10",
      "--batch-timeout-seconds",
      process.env.SARVAM_BATCH_TIMEOUT_SECONDS || "900",
      "--output",
      outputPath,
    ],
    { encoding: "utf8", env: process.env },
  );
  if (run.status !== 0) {
    throw new Error(`Sarvam batch failed for ${path.basename(audio)}: ${run.stderr.slice(-500) || run.stdout.slice(-500)}`);
  }
  const payload = JSON.parse(readFileSync(outputPath, "utf8")) as SarvamOutput & { error?: string; message?: string };
  if (payload.error) throw new Error(`Sarvam batch failed: ${payload.error} ${payload.message ?? ""}`.trim());
  return payload;
}

function printResult(result: CalibrationResult) {
  console.log(`\n=== ${path.basename(result.file)} ===`);
  console.log(`clip: ${path.basename(result.clip)}`);
  console.log(`segments: ${result.segmentCount}`);
  console.log(`mapping: ${JSON.stringify(result.mapping)} (${result.confidence})`);
  console.log(`reason: ${result.reason}`);
  for (const segment of result.segments) {
    console.log(`[${segment.timestamp}] raw=${segment.rawSpeaker} mapped=${segment.mappedSpeaker} ${segment.text}`);
  }
}

function envSpeaker(name: string, fallback: CanonicalSpeakerRole): CanonicalSpeakerRole {
  const raw = (process.env[name] || "").trim().toLowerCase();
  return raw === "agent" || raw === "customer" || raw === "unknown" ? raw : fallback;
}

function envMappingMode(): SpeakerMappingMode {
  if ((process.env.SARVAM_MAP_SPEAKERS_TO_AGENT_CUSTOMER || "true").toLowerCase() === "false") return "raw";
  const raw = (process.env.SARVAM_SPEAKER_MAPPING_MODE || "heuristic").trim().toLowerCase();
  return raw === "fixed" || raw === "heuristic" || raw === "raw" ? raw : "heuristic";
}

function normalizeRawSpeaker(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw || raw === "unknown" || raw === "agent" || raw === "customer" || raw === "system") return null;
  return raw.replace(/^speaker[_\s-]?/, "").replace(/^spk[_\s-]?/, "").trim();
}

function fmt(seconds: number | null | undefined): string {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) return "??:??";
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

main();
