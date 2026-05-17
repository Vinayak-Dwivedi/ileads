"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateTranscriptSegmentSpeaker } from "./actions";

type SpeakerValue = "AGENT" | "CUSTOMER" | "UNKNOWN";

interface Props {
  segmentId: string;
  speaker: SpeakerValue;
  disabled?: boolean;
}

export function SegmentSpeakerSelect({ segmentId, speaker, disabled = false }: Props) {
  const router = useRouter();
  const [value, setValue] = useState<SpeakerValue>(speaker);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onChange(next: SpeakerValue) {
    setValue(next);
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await updateTranscriptSegmentSpeaker(segmentId, next.toLowerCase());
      if (result.ok) {
        setMessage("Saved. Re-run AI Audit for updated scoring.");
        router.refresh();
      } else {
        setValue(speaker);
        setError(result.error ?? "Could not update speaker.");
      }
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select
        value={value}
        disabled={disabled || pending}
        onChange={(event) => onChange(event.target.value as SpeakerValue)}
        className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 shadow-sm disabled:opacity-60"
        aria-label="Correct speaker label"
      >
        <option value="AGENT">Agent</option>
        <option value="CUSTOMER">Customer</option>
        <option value="UNKNOWN">Unknown</option>
      </select>
      {pending ? <span className="text-[11px] font-normal text-slate-400">Saving...</span> : null}
      {message ? <span className="text-[11px] font-normal text-amber-700">{message}</span> : null}
      {error ? <span className="text-[11px] font-normal text-red-600">{error}</span> : null}
    </span>
  );
}
