"use client";

import { useState, useTransition } from "react";
import { Wand2, AlertTriangle, CheckCircle2, RotateCcw } from "lucide-react";
import { processDemoCall, resetProcessingState, type ProcessDemoCallResult } from "./actions";

interface Props {
  callId: string;
  hasAudio: boolean;
  hasTranscript: boolean;
  hasParameters: boolean;
  hasAudit: boolean;
  durationSeconds: number | null;
  openrouterKeyConfigured: boolean;
  mockMode: boolean;
  sttProvider: "local" | "sarvam";
  sarvamKeyConfigured: boolean;
  processingStatus?: string | null;
  processingStateLabel?: string | null;
  canResetProcessing?: boolean;
  processingError?: string | null;
}

export function ProcessDemoPanel({
  callId,
  hasAudio,
  hasTranscript,
  hasParameters,
  hasAudit,
  durationSeconds,
  openrouterKeyConfigured,
  mockMode,
  sttProvider,
  sarvamKeyConfigured,
  processingStatus,
  processingStateLabel,
  canResetProcessing = false,
  processingError,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ProcessDemoCallResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await processDemoCall(callId);
        setResult(r);
        if (!r.ok && r.errorMessage) setError(r.errorMessage);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to process call.");
      }
    });
  }

  // Preflight: pick a single clear blocker message.
  const lockedByOther = !!processingStatus;
  const longCall = durationSeconds != null && durationSeconds >= 180;
  let blockMessage: string | null = null;
  if (lockedByOther) {
    blockMessage = `Processing in progress (${processingStatus}). Please wait for the current step to complete.`;
  } else if (!hasAudio) blockMessage = "Audio file required.";
  else if (sttProvider === "sarvam" && !sarvamKeyConfigured && !hasTranscript)
    blockMessage = "Sarvam API key missing. Add SARVAM_API_KEY in .env and restart PM2.";
  else if (mockMode && !hasTranscript)
    blockMessage = "Local STT is disabled (MOCK_STT=true). Cannot run transcription.";
  else if (!hasParameters) blockMessage = "Add audit parameters before processing.";
  else if (!openrouterKeyConfigured)
    blockMessage = "OpenRouter API key missing. Add it in .env and restart PM2.";

  function doResetProcessing() {
    if (!confirm("Reset the processing state on this call? Use this only if a stage hung or crashed.")) return;
    setError(null);
    setResult(null);
    startTransition(async () => {
      const r = await resetProcessingState(callId);
      if (!r.ok) setError(r.error ?? "Reset failed.");
    });
  }

  const buttonLabel = pending
    ? hasTranscript
      ? "Running AI audit…"
      : "Transcribing then auditing…"
    : hasAudit
      ? "Re-process Demo Call"
      : "Process Demo Call";

  return (
    <article className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-3">
        <Wand2 className="h-4 w-4" /> Process Demo Call
      </div>
      <p className="text-xs text-slate-500 mb-3">
        One-click: runs transcription (if missing), then the AI audit.
        Longer calls may take several minutes. Keep this page open while processing.
      </p>
      {longCall ? (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          This call is long. Transcription may take several minutes.
        </div>
      ) : null}
      <button
        type="button"
        onClick={run}
        disabled={pending || blockMessage !== null}
        className="html-btn html-btn-primary disabled:opacity-60"
        title={blockMessage ?? buttonLabel}
      >
        <Wand2 className="h-4 w-4" />
        {buttonLabel}
      </button>

      {blockMessage ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {blockMessage}
        </div>
      ) : null}
      {processingError ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Last error: {processingError}
        </div>
      ) : null}
      {canResetProcessing ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={doResetProcessing}
            disabled={pending}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset processing state
          </button>
          <p className="mt-1 text-[11px] text-slate-500">
            Use this if a previous run crashed or failed{processingStateLabel ? ` (${processingStateLabel})` : ""}.
            Locks automatically clear after 30 minutes.
          </p>
        </div>
      ) : null}

      {pending ? (
        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          {hasTranscript
            ? "Running AI audit… up to 2 minutes. Keep this page open."
            : "Step 1/2 transcribing audio, then step 2/2 AI audit. Longer calls may take several minutes — keep this page open."}
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 inline-flex items-start gap-1">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-3 space-y-1 text-xs">
          <StageLine
            label="1. Transcription"
            ran={result.transcription?.ran ?? false}
            ok={result.transcription?.ok ?? false}
            skipped={result.transcription?.skippedReason}
            detail={
              result.transcription?.ok
                ? `${result.transcription.winningModel}${result.transcription.usedFallback ? " (fallback)" : ""}${
                    result.transcription.segmentCount != null
                      ? `, ${result.transcription.segmentCount} segments`
                      : ""
                  }`
                : result.transcription?.errorMessage
            }
          />
          <StageLine
            label="2. AI Audit"
            ran={result.audit?.ran ?? false}
            ok={result.audit?.ok ?? false}
            skipped={result.audit?.skippedReason}
            detail={
              result.audit?.ok
                ? `Run #${result.audit.auditRunNo}, ${
                    result.audit.scorePercent != null ? Math.round(result.audit.scorePercent) : "—"
                  }%, ${result.audit.model}${result.audit.usedFallback ? " (fallback)" : ""}`
                : result.audit?.errorMessage
            }
          />
        </div>
      ) : null}
    </article>
  );
}

function StageLine({
  label,
  ran,
  ok,
  skipped,
  detail,
}: {
  label: string;
  ran: boolean;
  ok: boolean;
  skipped?: string;
  detail?: string;
}) {
  const tone =
    skipped !== undefined
      ? "text-slate-500"
      : ran && ok
        ? "text-emerald-700"
        : ran
          ? "text-red-700"
          : "text-slate-400";
  const icon = skipped ? "·" : ran && ok ? "✓" : ran ? "✕" : "·";
  return (
    <div className={`inline-flex items-start gap-2 ${tone}`}>
      <span className="font-mono">{icon}</span>
      <span>
        <span className="font-semibold">{label}:</span>{" "}
        {skipped
          ? `skipped — ${skipped}`
          : ran && ok
            ? `done — ${detail ?? ""}`
            : ran
              ? `failed — ${detail ?? ""}`
              : "did not run"}
      </span>
    </div>
  );
}
