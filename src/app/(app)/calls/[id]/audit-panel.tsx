"use client";

import { useState, useTransition } from "react";
import { Sparkles, RefreshCw, AlertTriangle } from "lucide-react";
import { runMockAudit, type MockAuditDebugInfo } from "./actions";

interface Props {
  callId: string;
  hasAudit: boolean;
  hasTranscript: boolean;
  hasParameters: boolean;
  latestRunNo: number | null;
  isDevelopment: boolean;
}

export function AuditPanel({ callId, hasAudit, hasTranscript, hasParameters, latestRunNo, isDevelopment }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<MockAuditDebugInfo | null>(null);
  const [open, setOpen] = useState(false);

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        const info = await runMockAudit(callId);
        setDebug(info);
        setOpen(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Mock audit failed");
      }
    });
  }

  return (
    <article className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-3">
        <Sparkles className="h-4 w-4" /> AI Audit Pipeline
        {latestRunNo != null ? (
          <span className="ml-auto text-xs font-normal text-slate-500">Run #{latestRunNo}</span>
        ) : null}
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Runs the local mock pipeline: build prompt → mock response → validate (binary scoring
        enforced) → save audit, parameter scores, events, and update the call score.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={run}
          disabled={pending || !hasTranscript || !hasParameters}
          className="html-btn html-btn-primary disabled:opacity-60"
        >
          {hasAudit ? (
            <>
              <RefreshCw className="h-4 w-4" /> {pending ? "Re-running…" : "Re-run Mock AI Audit"}
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" /> {pending ? "Running…" : "Run Mock AI Audit"}
            </>
          )}
        </button>
        {error ? (
          <span className="text-xs text-red-600 inline-flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
          </span>
        ) : null}
      </div>
      {!hasTranscript ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Run transcription first.
        </div>
      ) : null}
      {hasTranscript && !hasParameters ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Add audit parameters before running audit.
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
                  Run the mock audit to capture the prompt, raw response, and validated payload.
                  Nothing here is persisted to the rendered UI.
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
                    label="Raw mock response"
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
