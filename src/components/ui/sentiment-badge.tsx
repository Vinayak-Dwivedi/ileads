import { Smile, Meh, Frown, MinusCircle } from "lucide-react";

interface SentimentBadgeProps {
  value: string | null | undefined;
}

export function SentimentBadge({ value }: SentimentBadgeProps) {
  const v = (value ?? "").toUpperCase();
  if (v === "POSITIVE") {
    return (
      <span className="inline-flex items-center gap-2 text-emerald-600">
        <Smile className="h-4 w-4" /> Positive
      </span>
    );
  }
  if (v === "NEGATIVE") {
    return (
      <span className="inline-flex items-center gap-2 text-red-500">
        <Frown className="h-4 w-4" /> Negative
      </span>
    );
  }
  if (v === "NEUTRAL") {
    return (
      <span className="inline-flex items-center gap-2 text-amber-600">
        <Meh className="h-4 w-4" /> Neutral
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-slate-400">
      <MinusCircle className="h-4 w-4" />—
    </span>
  );
}
