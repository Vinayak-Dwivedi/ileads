import type { SpeakerRole } from "@prisma/client";

export interface SttSegment {
  speaker?: SpeakerRole;
  startMs: number;
  endMs: number;
  text: string;
  confidenceScore?: number | null;
  channel?: string | null;
  speakerSource?: string | null;
}

export interface SttResult {
  language: string;
  modelUsed: string;
  provider: string;
  fullText: string;
  segments: SttSegment[];
  /** Engine-specific debug payload. Not persisted; surfaced in smoke tests. */
  raw?: Record<string, unknown>;
  qualityFlags?: string[];
  fallbackReason?: string | null;
}

export interface SttEngine {
  readonly name: string;
  transcribe(audioPath: string): Promise<SttResult>;
}

/** Error codes that the Node adapter surfaces to UI / smoke tests. */
export type SttErrorCode =
  | "MOCK_MODE"
  | "MODEL_NOT_FOUND"
  | "AUDIO_NOT_FOUND"
  | "DEPENDENCY_MISSING"
  | "PYTHON_NOT_FOUND"
  | "TRANSCRIBE_FAILED"
  | "TIMEOUT"
  | "BAD_OUTPUT"
  | "NOT_IMPLEMENTED"
  | "QUALITY_GATE"
  | "SARVAM_API_KEY_MISSING"
  | "SARVAM_HTTP_ERROR"
  | "SARVAM_TIMEOUT"
  | "SARVAM_BATCH_FAILED"
  | "SARVAM_INVALID_RESPONSE"
  | "SARVAM_TRANSCRIBE_FAILED"
  | "DEEPGRAM_API_KEY_MISSING"
  | "DEEPGRAM_HTTP_ERROR"
  | "DEEPGRAM_TIMEOUT"
  | "DEEPGRAM_INVALID_RESPONSE";

export class SttError extends Error {
  readonly code: SttErrorCode;
  readonly details?: unknown;
  constructor(code: SttErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
