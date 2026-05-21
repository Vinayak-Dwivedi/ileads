import "server-only";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { SpeakerRole } from "@prisma/client";
import { SttError, type SttEngine, type SttResult, type SttSegment } from "../types";

// Deepgram REST engine. Talks to https://api.deepgram.com/v1/listen with
// the audio bytes in the body. Returns a fully-formed SttResult so the
// pipeline (saveTranscript, audit, etc.) treats it identically to Sarvam
// or local STT.
//
// Configuration is environment-driven (no SttConfig.deepgram block — we
// keep this engine independent of the existing config schema so plugging
// in third-party providers via the registry stays a single-file diff):
//   DEEPGRAM_API_KEY      required
//   DEEPGRAM_MODEL        default "nova-2"
//   DEEPGRAM_LANGUAGE     default "multi" (Deepgram auto-detect)
//   DEEPGRAM_TIMEOUT_MS   default 120000

const ENDPOINT = "https://api.deepgram.com/v1/listen";

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".webm": "audio/webm",
  ".flac": "audio/flac",
};

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: number;
}

interface DeepgramAlternative {
  transcript: string;
  confidence?: number;
  words?: DeepgramWord[];
}

interface DeepgramChannel {
  alternatives: DeepgramAlternative[];
  detected_language?: string;
}

interface DeepgramResponse {
  metadata?: {
    request_id?: string;
    duration?: number;
    channels?: number;
    models?: string[];
    model_info?: Record<string, { name?: string }>;
  };
  results?: {
    channels?: DeepgramChannel[];
  };
}

export class DeepgramSttEngine implements SttEngine {
  readonly name = "deepgram";

  async transcribe(audioPath: string): Promise<SttResult> {
    if (!existsSync(audioPath)) {
      throw new SttError("AUDIO_NOT_FOUND", `Audio file does not exist: ${audioPath}`);
    }
    const apiKey = (process.env.DEEPGRAM_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new SttError(
        "DEEPGRAM_API_KEY_MISSING",
        "DEEPGRAM_API_KEY not set. Add it in .env and restart the worker.",
      );
    }

    const model = process.env.DEEPGRAM_MODEL || "nova-2";
    const language = process.env.DEEPGRAM_LANGUAGE || "multi";
    const timeoutMs = Number(process.env.DEEPGRAM_TIMEOUT_MS ?? "120000") || 120000;

    const url = new URL(ENDPOINT);
    url.searchParams.set("model", model);
    url.searchParams.set("language", language);
    url.searchParams.set("punctuate", "true");
    url.searchParams.set("smart_format", "true");
    url.searchParams.set("diarize", "true");
    url.searchParams.set("utterances", "false");

    const ext = path.extname(audioPath).toLowerCase();
    const contentType = CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";

    const body = await readFile(audioPath);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": contentType,
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === "AbortError") {
        throw new SttError("DEEPGRAM_TIMEOUT", `Deepgram timed out after ${timeoutMs}ms.`);
      }
      throw new SttError(
        "DEEPGRAM_HTTP_ERROR",
        `Deepgram request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    clearTimeout(timer);

    if (!response.ok) {
      const excerpt = (await response.text().catch(() => "")).slice(0, 500);
      throw new SttError(
        "DEEPGRAM_HTTP_ERROR",
        `Deepgram HTTP ${response.status}: ${excerpt}`,
      );
    }

    let parsed: DeepgramResponse;
    try {
      parsed = (await response.json()) as DeepgramResponse;
    } catch (err) {
      throw new SttError(
        "DEEPGRAM_INVALID_RESPONSE",
        `Could not parse Deepgram response: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const channel = parsed.results?.channels?.[0];
    const alternative = channel?.alternatives?.[0];
    if (!alternative) {
      throw new SttError("DEEPGRAM_INVALID_RESPONSE", "Deepgram returned no alternatives.");
    }

    const segments = wordsToSegments(alternative.words ?? []);
    const fullText =
      alternative.transcript?.trim() ||
      segments.map((s) => s.text).join(" ").trim();

    return {
      language: channel?.detected_language ?? language,
      modelUsed: model,
      provider: "deepgram",
      fullText,
      segments,
      raw: parsed as unknown as Record<string, unknown>,
      qualityFlags: [],
      fallbackReason: null,
    };
  }
}

// Group consecutive same-speaker words into segments. Deepgram returns words
// individually with .speaker = 0/1/2 from diarization; we collapse runs.
function wordsToSegments(words: DeepgramWord[]): SttSegment[] {
  if (words.length === 0) return [];
  const segments: SttSegment[] = [];
  let currentSpeaker: number | undefined = words[0].speaker;
  let currentStart = words[0].start;
  let currentEnd = words[0].end;
  let buffer: string[] = [];
  let confSum = 0;
  let confCount = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    segments.push({
      speaker: currentSpeaker != null ? speakerIdToRole(currentSpeaker) : SpeakerRole.UNKNOWN,
      startMs: Math.round(currentStart * 1000),
      endMs: Math.round(currentEnd * 1000),
      text: buffer.join(" ").trim(),
      confidenceScore: confCount > 0 ? confSum / confCount : null,
      speakerSource:
        currentSpeaker != null ? `deepgram:diarize:${currentSpeaker}` : "deepgram:none",
    });
    buffer = [];
    confSum = 0;
    confCount = 0;
  };

  for (const w of words) {
    if (w.speaker !== currentSpeaker) {
      flush();
      currentSpeaker = w.speaker;
      currentStart = w.start;
    }
    currentEnd = w.end;
    buffer.push(w.punctuated_word ?? w.word);
    if (typeof w.confidence === "number") {
      confSum += w.confidence;
      confCount += 1;
    }
  }
  flush();
  return segments;
}

// Heuristic mapping: Deepgram speaker 0 -> AGENT, others -> CUSTOMER.
// inferSpeakerRoles can re-map post-hoc; this just gives us a plausible
// default before the speech-pattern heuristic runs.
function speakerIdToRole(id: number): SpeakerRole {
  return id === 0 ? SpeakerRole.AGENT : SpeakerRole.CUSTOMER;
}
