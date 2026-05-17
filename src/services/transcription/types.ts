import type { SpeakerRole } from "@prisma/client";

export interface TranscriptSegmentInput {
  sequence: number;
  speaker: SpeakerRole;
  startMs: number;
  endMs: number;
  text: string;
  confidenceScore?: number | null;
  channel?: string | null;
  speakerSource?: string | null;
}

export interface TranscriptResult {
  language: string;
  modelUsed: string;
  fullText: string;
  segments: TranscriptSegmentInput[];
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
  attemptedModels?: unknown;
  qualityFlags?: string[];
}
