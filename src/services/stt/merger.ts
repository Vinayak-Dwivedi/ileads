import type { SttResult } from "./types";

export function mergeSttResults(primary: SttResult, fallback?: SttResult | null): SttResult {
  if (!fallback) return primary;
  return primary.segments.length >= fallback.segments.length ? primary : fallback;
}
