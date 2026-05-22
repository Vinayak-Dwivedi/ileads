"use client";

import { useState, useTransition } from "react";
import { Mic, RefreshCw } from "lucide-react";
import { runLocalSttTranscription } from "./actions";

interface Props {
  callId: string;
  hasAudio: boolean;
  hasTranscript: boolean;
  mockMode: boolean;
  sttProvider: "local" | "sarvam" | "assemblyai" | "deepgram";
  sarvamKeyConfigured: boolean;
  processingStatus?: string | null;
  processingFailed?: boolean;
  compact?: boolean;
}

export function TranscriptionActionButton({
  callId,
  hasAudio,
  hasTranscript,
  mockMode,
  sttProvider,
  sarvamKeyConfigured,
  processingStatus,
  processingFailed = false,
  compact = false,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function runLive() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await runLocalSttTranscription(callId);
        if (result.ok) {
          const warning = result.speakerLabelWarning
            ? " Speaker labels are heuristic because this recording is mono."
            : "";
          if (result.usedFallback && result.fallbackReason === "sarvam_failed") {
            setMessage(
              `Sarvam failed. Transcription completed using local fallback: ${result.winningModel}` +
                (result.segmentCount != null ? ` (${result.segmentCount} segments).` : ".") +
                warning,
            );
          } else if (result.provider === "sarvam") {
            setMessage(
              `Transcription completed using Sarvam ${result.modelUsed ?? "model"}` +
                (result.segmentCount != null ? ` (${result.segmentCount} segments).` : ".") +
                warning,
            );
          } else if (result.usedFallback) {
            setMessage(
              `Transcription completed using fallback: ${result.winningModel}` +
                (result.segmentCount != null ? ` (${result.segmentCount} segments).` : ".") +
                warning,
            );
          } else {
            setMessage(
              `Transcription completed using ${result.winningModel}` +
                (result.segmentCount != null ? ` (${result.segmentCount} segments).` : ".") +
                warning,
            );
          }
        } else {
          setError(safeSttErrorMessage(result.errorCode, result.errorMessage));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Local STT failed.");
      }
    });
  }

  const lockedByOther = !!processingStatus;
  const sarvamMissingKey = sttProvider === "sarvam" && !sarvamKeyConfigured;
  const liveDisabled = pending || !hasAudio || mockMode || lockedByOther || sarvamMissingKey;
  const liveBusy = pending;

  function safeSttErrorMessage(code: string | undefined, raw: string | undefined): string {
    switch (code) {
      case "MOCK_MODE":
        return "Local STT is disabled (MOCK_STT=true). Set MOCK_STT=false in .env and restart PM2.";
      case "MODEL_NOT_FOUND":
        return "STT model files are missing on the server. Run the model download script and retry.";
      case "AUDIO_NOT_FOUND":
        return "Audio file is missing for this call. Re-upload the call and try again.";
      case "DEPENDENCY_MISSING":
      case "PYTHON_NOT_FOUND":
        return "STT runtime is not installed. Contact the server admin.";
      case "TIMEOUT":
        return "Transcription timed out. The audio may be too long. Please retry.";
      case "TRANSCRIBE_FAILED":
      case "BAD_OUTPUT":
        return "Transcription failed on both primary and fallback models. Please retry; if it keeps failing, contact the admin.";
      case "QUALITY_GATE":
        return "Transcript quality was too low to save. Please retry with cleaner audio.";
      case "SARVAM_API_KEY_MISSING":
        return "Sarvam API key missing. Add SARVAM_API_KEY in .env and restart PM2.";
      case "SARVAM_TIMEOUT":
        return "Sarvam transcription timed out. Please retry or use a shorter audio file.";
      case "SARVAM_BATCH_FAILED":
        return "Sarvam batch transcription failed. Please retry.";
      case "SARVAM_HTTP_ERROR":
        return "Sarvam transcription request failed. Please retry.";
      case "SARVAM_INVALID_RESPONSE":
        return "Sarvam returned no usable transcript text. Please retry or use local fallback.";
      case "SARVAM_TRANSCRIBE_FAILED":
        return "Sarvam transcription failed. Please retry; local fallback may be used if enabled.";
      default:
        return raw && raw.length <= 200 ? raw : "Transcription failed. Please retry; if it keeps failing, contact the admin.";
    }
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <button
        type="button"
        onClick={runLive}
        disabled={liveDisabled}
        className={
          compact
            ? "inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
            : "inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
        }
        title={
          mockMode
            ? "Set MOCK_STT=false in .env to enable local STT."
            : sarvamMissingKey
              ? "Add SARVAM_API_KEY in .env and restart PM2."
              : "Re-run live transcription."
        }
      >
        {hasTranscript ? <RefreshCw className={`h-4 w-4 ${liveBusy ? "animate-spin" : ""}`} /> : <Mic className="h-4 w-4" />}
        {liveBusy
          ? "Transcribing…"
          : processingFailed
            ? "Retry Live Transcription"
            : hasTranscript
              ? "Re-run Live Transcription"
              : "Run Live Transcription"}
      </button>
      {compact ? (
        <div className="space-y-1 text-right text-[11px] leading-snug">
          {!hasAudio ? <p className="text-amber-700">Audio file required.</p> : null}
          {mockMode ? <p className="text-slate-600">Local STT disabled. Mock transcription only.</p> : null}
          {sarvamMissingKey ? <p className="text-amber-700">Sarvam API key missing.</p> : null}
          {lockedByOther ? <p className="text-slate-600">Processing in progress ({processingStatus}).</p> : null}
          {liveBusy ? <p className="text-blue-700">Transcribing...</p> : null}
          {message ? <p className="text-emerald-700">{message}</p> : null}
          {error ? <p className="text-red-600">{error}</p> : null}
        </div>
      ) : (
        <>
          {!hasAudio ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Audio file required.
            </div>
          ) : null}
          {mockMode ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Local STT is disabled (<code>MOCK_STT=true</code>). Mock transcription is the only active path.
            </div>
          ) : null}
          {sarvamMissingKey ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Sarvam API key missing. Add <code>SARVAM_API_KEY</code> in .env and restart PM2.
            </div>
          ) : null}
          {liveBusy ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              Transcribing… longer calls may take a few minutes. Please keep this page open.
            </div>
          ) : null}
          {lockedByOther ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Processing in progress ({processingStatus}). Please wait for the current step to complete.
            </div>
          ) : null}
          {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </>
      )}
    </div>
  );
}