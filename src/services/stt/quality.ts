import type { SttResult } from "./types";

export function averageSttConfidence(result: SttResult): number | null {
  const values = result.segments
    .map((segment) => segment.confidenceScore)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface SttQualityReport {
  ok: boolean;
  flags: string[];
}

export function evaluateSttQuality(result: SttResult): SttQualityReport {
  const fullText = (result.fullText || result.segments.map((s) => s.text).join(" ")).trim();
  const flags = new Set<string>();

  if (!fullText) flags.add("empty_text");
  if (fullText.length > 0 && fullText.length < 30) flags.add("short_text");

  const tokens = fullText
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length > 0 && tokens.length < 6) flags.add("low_word_count");

  const singleCharCount = tokens.filter((token) => Array.from(token).length === 1).length;
  if (tokens.length >= 10 && singleCharCount / tokens.length > 0.35) {
    flags.add("too_many_single_character_tokens");
  }

  const tokenCounts = new Map<string, number>();
  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (Array.from(normalized).length < 2) continue;
    tokenCounts.set(normalized, (tokenCounts.get(normalized) ?? 0) + 1);
  }
  const maxTokenRepeats = Math.max(0, ...tokenCounts.values());
  if (tokens.length >= 8 && maxTokenRepeats >= 5 && maxTokenRepeats / tokens.length > 0.35) {
    flags.add("repeated_tokens");
  }

  const phraseCounts = new Map<string, number>();
  for (let i = 0; i <= tokens.length - 3; i++) {
    const phrase = tokens.slice(i, i + 3).join(" ").toLowerCase();
    phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
  }
  if (Math.max(0, ...phraseCounts.values()) >= 3) {
    flags.add("repeated_phrase");
  }

  if (/[�]{1,}/.test(fullText) || /(.)\1{12,}/u.test(fullText)) {
    flags.add("garbled_text");
  }

  const speechLikeChars = Array.from(fullText).filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length;
  if (fullText.length >= 20 && speechLikeChars / Array.from(fullText).length < 0.4) {
    flags.add("mostly_non_speech");
  }

  const heuristicSpeakerLabels = result.segments.some((segment) => segment.speakerSource === "heuristic");
  if (heuristicSpeakerLabels) flags.add("heuristic_speaker_labels");

  const blockingFlags = Array.from(flags).filter((flag) => flag !== "heuristic_speaker_labels");
  return { ok: blockingFlags.length === 0, flags: Array.from(flags) };
}
