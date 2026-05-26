import "server-only";
import { prisma } from "@/lib/db";
import { getAudioStorageRoot } from "@/lib/audio-storage";
import { probeAudioDurationSeconds } from "@/lib/audio-duration";
import { getStorageProvider, materializeAudioToLocalFile } from "@/services/storage";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  loadSttConfig,
  SttError,
  transcribeWithChain,
  type AttemptResult,
} from "@/services/stt";
import type { SpeakerRole } from "@prisma/client";
import { saveTranscript } from "./saveTranscript";
import type { TranscriptResult } from "./types";

export interface RunLocalSttResult {
  transcriptId: string;
  segmentCount: number;
  modelUsed: string;
  language: string;
  provider: string;
  /** Model key that produced the saved transcript. */
  winningModel: string;
  /** Per-attempt outcome in chain order. */
  attempts: AttemptResult[];
  /** True iff a fallback (not the primary) produced the transcript. */
  usedFallback: boolean;
  fallbackReason: string | null;
  attemptedModels: string[];
  qualityFlags: string[];
  speakerLabelWarning: boolean;
}

/**
 * Runs the configured STT chain (IndicConformer -> faster-whisper-small) for a call
 * and persists the transcript from the first model that succeeds.
 *
 * Throws SttError when *every* model in the chain failed; the action layer
 * surfaces the code to the UI. The existing transcript is preserved on
 * failure — saveTranscript only runs after a successful engine response.
 */
export async function runLocalSttForCall(callId: string, clientId: string): Promise<RunLocalSttResult> {
  const config = loadSttConfig();
  if (config.mock) {
    throw new SttError(
      "MOCK_MODE",
      "Local STT is disabled (MOCK_STT=true). Set MOCK_STT=false to enable.",
    );
  }

  const call = await prisma.call.findFirst({
    where: { id: callId, clientId },
    select: { id: true, audioPath: true },
  });
  if (!call) throw new Error("Call not found.");
  if (!call.audioPath) {
    throw new SttError("AUDIO_NOT_FOUND", "This call has no local audio file to transcribe.");
  }

  // STT engines (Sarvam's Python process, Deepgram's fs.readFile) and ffprobe
  // all need a real local file. For the local provider the audioPath already
  // points at one; for remote providers (S3) we stream the object to a temp
  // file and delete it once transcription finishes.
  const provider = getStorageProvider();
  let absoluteAudio: string;
  let cleanupAudio: () => Promise<void> = async () => {};
  if (provider.name === "local") {
    absoluteAudio = resolveAudioPath(call.audioPath);
    if (!existsSync(absoluteAudio)) {
      throw new SttError("AUDIO_NOT_FOUND", `Audio file not found on disk: ${absoluteAudio}`);
    }
  } else {
    try {
      const handle = await materializeAudioToLocalFile(call.audioPath);
      absoluteAudio = handle.path;
      cleanupAudio = handle.cleanup;
    } catch (e) {
      throw new SttError(
        "AUDIO_NOT_FOUND",
        `Could not fetch audio from storage (key=${call.audioPath}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  try {
    await ensureCallDuration(call.id, absoluteAudio);

    const chain = await transcribeWithChain(absoluteAudio, config);
    if (!chain.result || !chain.winningModel) {
      const last = chain.attempts[chain.attempts.length - 1];
      throw new SttError(
        (last?.errorCode as SttError["code"]) || "TRANSCRIBE_FAILED",
        `All STT models failed (${chain.attempts.map((a) => `${a.model}=${a.errorCode}`).join(", ")}). Last error: ${last?.errorMessage ?? "unknown"}`,
        { attempts: chain.attempts },
      );
    }

    const sttResult = chain.result;
    const transcript: TranscriptResult = {
      language: sttResult.language,
      modelUsed: sttResult.modelUsed,
      fullText:
        sttResult.fullText ||
        sttResult.segments.map((s) => s.text).filter(Boolean).join(" "),
      segments: sttResult.segments.map((seg, idx) => ({
        sequence: idx + 1,
        speaker: (seg.speaker ?? "UNKNOWN") as SpeakerRole,
        startMs: seg.startMs,
        endMs: seg.endMs,
        text: seg.text,
        confidenceScore: seg.confidenceScore ?? null,
        channel: seg.channel ?? null,
        speakerSource: seg.speakerSource ?? null,
      })),
      fallbackUsed: chain.fallbackReason != null,
      fallbackReason: chain.fallbackReason,
      attemptedModels: chain.attempts.map((attempt) => ({
        provider: attempt.provider,
        model: attempt.model,
        ok: attempt.ok,
        errorCode: attempt.errorCode,
        errorMessage: attempt.errorMessage,
        qualityFlags: attempt.qualityFlags ?? [],
        durationMs: attempt.durationMs,
      })),
      qualityFlags: chain.qualityFlags,
    };

    const saved = await saveTranscript(call.id, transcript);
    return {
      transcriptId: saved.id,
      segmentCount: transcript.segments.length,
      modelUsed: transcript.modelUsed,
      language: transcript.language,
      provider: sttResult.provider,
      winningModel: chain.winningModel,
      attempts: chain.attempts,
      usedFallback: chain.fallbackReason != null,
      fallbackReason: chain.fallbackReason,
      attemptedModels: chain.attempts.map((attempt) => `${attempt.provider}:${attempt.model}`),
      qualityFlags: chain.qualityFlags,
      speakerLabelWarning: transcript.segments.some((seg) =>
        ["heuristic", "sarvam_no_diarization"].includes(seg.speakerSource ?? ""),
      ),
    };
  } finally {
    await cleanupAudio();
  }
}

async function ensureCallDuration(callId: string, audioPath: string): Promise<void> {
  const existing = await prisma.call.findUnique({
    where: { id: callId },
    select: { durationSeconds: true },
  });
  if (existing?.durationSeconds != null) return;
  const durationSeconds = await probeAudioDurationSeconds(audioPath);
  if (durationSeconds == null) return;
  await prisma.call.update({
    where: { id: callId },
    data: { durationSeconds },
  });
}

function resolveAudioPath(audioPath: string): string {
  if (path.isAbsolute(audioPath)) return audioPath;
  const root = getAudioStorageRoot();
  const candidate = path.join(root, audioPath);
  if (existsSync(candidate)) return candidate;
  return path.resolve(audioPath);
}
