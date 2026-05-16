import type { SttResult } from "./types";

export function averageSttConfidence(result: SttResult): number | null {
  const values = result.segments
    .map((segment) => segment.confidenceScore)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
