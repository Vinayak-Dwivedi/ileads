"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, RefreshCw, Sparkles } from "lucide-react";
import { runLiveAudit } from "./actions";

interface Props {
  callId: string;
  hasTranscript: boolean;
  hasAudit: boolean;
  needsAuditRerun: boolean;
  processingStatus?: string | null;
}

export function SpeakerCorrectionPanel({
  callId,
  hasTranscript,
  hasAudit,
  needsAuditRerun,
  processingStatus,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auditRunning, setAuditRunning] = useState(false);

  const locked = Boolean(processingStatus);
  const showRerun = hasAudit && needsAuditRerun;

  function rerunAudit() {
    setMessage(null);
    setError(null);
    setAuditRunning(true);
    startTransition(async () => {
      try {
        const result = await runLiveAudit(callId);
        if (result.ok) {
          setMessage(`AI audit re-run completed (Run #${result.auditRunNo}).`);
        } else {
          setError(result.errorMessage ?? "AI audit failed. Please retry.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "AI audit failed.");
      } finally {
        setAuditRunning(false);
      }
    });
  }

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-xs text-slate-600">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-800">Speaker correction</div>
          <div>Use the dropdown beside a transcript segment to correct only that line.</div>
        </div>
      </div>

      {locked ? (
        <div className="mt-2 text-amber-700">Processing in progress ({processingStatus}). Correction is disabled.</div>
      ) : null}
      {!hasTranscript ? <div className="mt-2 text-amber-700">Run transcription before correcting speakers.</div> : null}

      {showRerun ? (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
          <div className="mb-2 inline-flex items-start gap-1">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Speaker labels changed. Re-run AI Audit for updated scoring.
          </div>
          <button
            type="button"
            onClick={rerunAudit}
            disabled={pending || locked}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-600 px-3 font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
          >
            {auditRunning ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {auditRunning ? "Re-running AI Audit..." : "Re-run AI Audit after speaker correction"}
          </button>
        </div>
      ) : null}

      {message ? <div className="mt-2 text-emerald-700">{message}</div> : null}
      {error ? (
        <div className="mt-2 inline-flex items-start gap-1 text-red-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      ) : null}
    </div>
  );
}
