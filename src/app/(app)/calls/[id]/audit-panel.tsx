"use client";

import { useState, useTransition } from "react";
import { Sparkles, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { runLiveAudit, runMockAudit, type LiveAuditActionResult, type MockAuditDebugInfo } from "./actions";

interface Props {
  callId: string;
  hasAudit: boolean;
  hasTranscript: boolean;
  hasParameters: boolean;
  latestRunNo: number | null;
  isDevelopment: boolean;
  showMockAuditButton: boolean;
  openrouterKeyConfigured: boolean;
  processingStatus?: string | null;
}

export function AuditPanel({
  callId,
  hasAudit,
  hasTranscript,
  hasParameters,
  latestRunNo,
  isDevelopment,
  showMockAuditButton,
  openrouterKeyConfigured,
  processingStatus,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<"live" | "mock" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveResult, setLiveResult] = useState<LiveAuditActionResult | null>(null);
  const [debug, setDebug] = useState<MockAuditDebugInfo | null>(null);
  const [open, setOpen] = useState(false);

  function runLive() {
    setError(null);
    setLiveResult(null);
    setActiveAction("live");
    startTransition(async () => {
      try {
        const result = await runLiveAudit(callId);
        if (result.ok) {
          setLiveResult(result);
        } else {
          // Server action already maps errorCode -> safe user-facing text.
          setError(result.errorMessage ?? "Live AI audit failed. Please retry.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Live AI audit failed.");
      } finally {
        setActiveAction(null);
      }
    });
  }

  function runMock() {
    setError(null);
    setActiveAction("mock");
    startTransition(async () => {
      try {
        const info = await runMockAudit(callId);
        setDebug(info);
        setOpen(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Mock audit failed.");
      } finally {
        setActiveAction(null);
      }
    });
  }

  const liveBusy = pending && activeAction === "live";
  const mockBusy = pending && activeAction === "mock";

  const lockedByOther = !!processingStatus;
  const liveDisabled =
    pending || !hasTranscript || !hasParameters || !openrouterKeyConfigured || lockedByOther;

  let blockMessage: string | null = null;
  if (lockedByOther) {
    blockMessage = `Processing in progress (${processingStatus}). Please wait for the current step to complete.`;
  } else if (!hasTranscript) blockMessage = "Run transcription first.";
  else if (!hasParameters) blockMessage = "Add audit parameters first.";
  else if (!openrouterKeyConfigured)
    blockMessage = "OpenRouter API key missing. Add it in .env and restart PM2.";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runLive}
          disabled={liveDisabled}
          className="html-btn html-btn-primary disabled:opacity-60"
          title={blockMessage ?? (hasAudit ? "Re-run AI audit" : "Run AI audit")}
        >
          {hasAudit ? (
            <>
              <RefreshCw className="h-4 w-4" />
              {liveBusy ? "Re-running AI audit…" : "Re-run AI Audit"}
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {liveBusy ? "Running AI audit…" : "Run AI Audit"}
            </>
          )}
        </button>

        {error ? (
          <span className="text-xs text-red-600 inline-flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Block({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{label}</p>
      <pre className="text-[11px] leading-snug whitespace-pre-wrap wrap-break-word bg-white border border-slate-200 rounded-md p-2 max-h-64 overflow-y-auto">
        {content}
      </pre>
    </div>
  );
}
