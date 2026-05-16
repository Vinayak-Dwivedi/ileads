"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, FileText, RefreshCw } from "lucide-react";
import { runMockTranscription } from "./actions";

interface Props {
  callId: string;
  hasAudio: boolean;
  hasTranscript: boolean;
}

export function TranscriptionPanel({ callId, hasAudio, hasTranscript }: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await runMockTranscription(callId);
        setMessage(`${result.segmentCount} transcript segments saved.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Mock transcription failed.");
      }
    });
  }

  return (
    <article className="html-card p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
        <FileText className="h-4 w-4" /> Transcription
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Saves a demo Hinglish transcript to the database. Live STT remains disabled.
      </p>
      <button
        type="button"
        onClick={run}
        disabled={pending || !hasAudio}
        className="html-btn html-btn-primary"
      >
        {hasTranscript ? <RefreshCw className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        {pending
          ? "Transcribing..."
          : hasTranscript
            ? "Re-run Mock Transcription"
            : "Run Mock Transcription"}
      </button>
      {!hasAudio ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Audio file required.
        </div>
      ) : null}
      {message ? <p className="mt-3 text-xs text-emerald-700">{message}</p> : null}
      {error ? (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-red-600">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </p>
      ) : null}
    </article>
  );
}
