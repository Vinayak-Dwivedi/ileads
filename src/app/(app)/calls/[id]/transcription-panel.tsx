"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, FileText, Mic, RefreshCw } from "lucide-react";
import { runLocalSttTranscription, runMockTranscription } from "./actions";

interface Props {
  callId: string;
  hasAudio: boolean;
  hasTranscript: boolean;
  durationSeconds: number | null;
  mockMode: boolean;
  showMockActions: boolean;
  sttProvider: "local" | "sarvam";
  sarvamKeyConfigured: boolean;
  sarvamModel: string;
  sarvamUseBatch: boolean;
  /** "transcribing" | "auditing" | "processing_demo" — null means idle. */
  processingStatus?: string | null;
  processingFailed?: boolean;
  processingError?: string | null;
}

interface AttemptLine {
  provider?: string;
  model: string;
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  qualityFlags?: string[];
  durationMs: number;
}

export function TranscriptionPanel({
  callId,
  hasAudio,
  hasTranscript,
  durationSeconds,
  mockMode,
  showMockActions,
  sttProvider,
  sarvamKeyConfigured,
  sarvamModel,
  sarvamUseBatch,
  processingStatus,
  processingFailed = false,
  processingError,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<"mock" | "live" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<AttemptLine[] | null>(null);

  function runMock() {
    setMessage(null);
    setError(null);
    setAttempts(null);
    setActiveAction("mock");
    startTransition(async () => {
      try {
        const result = await runMockTranscription(callId);
        setMessage(`Mock transcription saved (${result.segmentCount} segments).`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Mock transcription failed.");
      } finally {
        setActiveAction(null);
      }
    });
  }

  function runLive() {
    setMessage(null);
    setError(null);
    setAttempts(null);
    setActiveAction("live");
    startTransition(async () => {
      try {
        const result = await runLocalSttTranscription(callId);
        setAttempts(result.attempts ?? null);
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
              `Transcription completed using Sarvam ${result.modelUsed ?? sarvamModel}` +
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
      } finally {
        setActiveAction(null);
      }
    });
  }

  const lockedByOther = !!processingStatus;
  const sarvamMissingKey = sttProvider === "sarvam" && !sarvamKeyConfigured;
  const liveDisabled = pending || !hasAudio || mockMode || lockedByOther || sarvamMissingKey;
  const longCall = durationSeconds != null && durationSeconds >= 180;
  const mockBusy = pending && activeAction === "mock";
  const liveBusy = pending && activeAction === "live";

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
        return raw && raw.length <= 200
          ? raw
          : "Transcription failed. Please retry; if it keeps failing, contact the admin.";
    }
  }

  return (
    <article className="html-card p-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
        <FileText className="h-4 w-4" /> Transcription
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Live transcription with speaker diarization. Longer calls may take several minutes —
        keep this page open while it runs.
      </p>
      {longCall ? (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          This call is long. Transcription may take several minutes.
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={runLive}
          disabled={liveDisabled}
          className="html-btn html-btn-primary"
          title={
            mockMode
              ? "Set MOCK_STT=false in .env to enable local STT."
              : sarvamMissingKey
                ? "Add SARVAM_API_KEY in .env and restart PM2."
              : "Run local STT (primary then fallbacks)."
          }
        >
          {hasTranscript ? <RefreshCw className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {liveBusy
            ? "Transcribing…"
            : processingFailed
              ? "Retry Live Transcription"
            : hasTranscript
              ? "Re-run Live Transcription"
              : "Run Live Transcription"}
        </button>

        {showMockActions ? (
          <button
            type="button"
            onClick={runMock}
            disabled={pending || !hasAudio}
            className="html-btn html-btn-secondary"
          >
            <FileText className="h-4 w-4" />
            {mockBusy ? "Transcribing..." : "Run Mock Transcription"}
          </button>
        ) : null}
      </div>

      {!hasAudio ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Audio file required.
        </div>
      ) : null}
      {mockMode ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Local STT is disabled (<code>MOCK_STT=true</code>). Mock transcription is the only active path.
        </div>
      ) : null}
      {sarvamMissingKey ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Sarvam API key missing. Add <code>SARVAM_API_KEY</code> in .env and restart PM2.
        </div>
      ) : null}
      {liveBusy ? (
        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          Transcribing… longer calls may take a few minutes. Please keep this page open.
        </div>
      ) : null}
      {!liveBusy && lockedByOther ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Processing in progress ({processingStatus}). Please wait for the current step to complete.
        </div>
      ) : null}
      {message ? <p className="mt-3 text-xs text-emerald-700">{message}</p> : null}
      {processingFailed && processingError ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Last transcription error: {processingError}
        </div>
      ) : null}
      {error ? (
        <p className="mt-3 inline-flex items-start gap-1 text-xs text-red-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      ) : null}
      {showMockActions && attempts && attempts.length > 0 ? (
        <details className="mt-3 text-xs text-slate-600">
          <summary className="cursor-pointer">STT chain attempts ({attempts.length})</summary>
          <ul className="mt-2 space-y-1 font-mono">
            {attempts.map((a, i) => (
              <li key={i}>
                {a.ok ? "OK  " : "FAIL"} {a.provider ? `${a.provider}:` : ""}{a.model} · {(a.durationMs / 1000).toFixed(2)}s
                {a.ok ? "" : ` · ${a.errorCode}: ${a.errorMessage}`}
                {a.qualityFlags?.length ? ` · flags: ${a.qualityFlags.join(", ")}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}
