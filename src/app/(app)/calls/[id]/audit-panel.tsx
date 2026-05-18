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
    <article className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-3">
        <Sparkles className="h-4 w-4" /> AI Audit Pipeline
        {latestRunNo != null ? (
          <span className="ml-auto text-xs font-normal text-slate-500">Run #{latestRunNo}</span>
        ) : null}
      </div>
      <p className="text-xs text-slate-500 mb-3">
        AI audit scores this call against active parameters using the transcript only — audio is
        never sent. Re-run after any speaker correction.
      </p>
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

        {showMockAuditButton ? (
          <button
            type="button"
            onClick={runMock}
            disabled={pending || !hasTranscript || !hasParameters}
            className="html-btn html-btn-secondary disabled:opacity-60"
            title="Developer-only mock audit. Hidden in production demo."
          >
            {mockBusy ? "Running…" : "Dev: Mock Audit"}
          </button>
        ) : null}

        {error ? (
          <span className="text-xs text-red-600 inline-flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
          </span>
        ) : null}
      </div>
      {blockMessage ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {blockMessage}
        </div>
      ) : null}

      {liveBusy ? (
        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
          Running AI audit… this may take up to 2 minutes. Please keep this page open.
        </div>
      ) : null}

      {liveResult && liveResult.ok ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <div className="inline-flex items-center gap-1 font-semibold">
            <CheckCircle2 className="h-3.5 w-3.5" /> Audit completed (Run #{liveResult.auditRunNo})
          </div>
          <div className="mt-1">
            Score: {liveResult.scorePercent != null ? Math.round(liveResult.scorePercent) : "—"}%
            {" · "}Parameters: {liveResult.parameterCount ?? 0}
            {" · "}Events: {liveResult.eventCount ?? 0}
            {" · "}Sentiment: {liveResult.sentiment ?? "—"}
            {liveResult.hasComplianceIssue ? ` · Compliance: ${liveResult.complianceSeverity}` : ""}
          </div>
          <div className="mt-1 text-emerald-700">
            Model: <code className="font-mono">{liveResult.model ?? "—"}</code>
            {liveResult.usedFallback ? (
              <span className="ml-1 italic">
                (primary <code className="font-mono">{liveResult.primaryModel}</code> was
                rate-limited; audit completed using fallback model)
              </span>
            ) : null}
          </div>
          {liveResult.warnings && liveResult.warnings.length > 0 ? (
            <details className="mt-1">
              <summary className="cursor-pointer">Validator warnings ({liveResult.warnings.length})</summary>
              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                {liveResult.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      {isDevelopment ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/60">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100/60"
          >
            <span>Debug panel (development only)</span>
            <span className="text-slate-400">{open ? "Hide" : "Show"}</span>
          </button>
          {open ? (
            <div className="border-t border-slate-200 p-3 space-y-3">
              {debug == null ? (
                <p className="text-xs text-slate-500">
                  Run the dev mock audit to capture the prompt, raw response, and validated payload.
                </p>
              ) : (
                <>
                  {debug.warnings.length > 0 ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                      <p className="font-semibold mb-1">Validator warnings ({debug.warnings.length})</p>
                      <ul className="list-disc pl-5 space-y-0.5">
                        {debug.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-xs text-emerald-700">No validator warnings.</p>
                  )}
                  <Block label={`Prompt (${debug.promptVersion})`} content={debug.prompt} />
                  <Block
                    label="Raw response"
                    content={JSON.stringify(debug.rawResponse, null, 2)}
                  />
                  <Block
                    label="Validated response (DB-safe)"
                    content={JSON.stringify(debug.validated, null, 2)}
                  />
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function Block({ label, content }: { label: string; content: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{label}</p>
      <pre className="text-[11px] leading-snug whitespace-pre-wrap break-words bg-white border border-slate-200 rounded-md p-2 max-h-64 overflow-y-auto">
        {content}
      </pre>
    </div>
  );
}
