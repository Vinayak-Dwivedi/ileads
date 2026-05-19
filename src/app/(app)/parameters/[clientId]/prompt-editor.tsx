"use client";

import { useState, useTransition } from "react";
import { FileText, Save, RotateCcw, AlertTriangle, CheckCircle2, Eye, Pencil } from "lucide-react";
import { resetClientPromptToDefault, saveClientPrompt } from "./prompt-actions";

interface CustomPrompt {
  id: string;
  promptName: string;
  promptText: string;
  versionNo: number;
}

interface Props {
  clientId: string;
  clientName: string;
  defaultPromptText: string;
  customPrompt: CustomPrompt | null;
}

export function PromptEditor({ clientId, clientName, defaultPromptText, customPrompt }: Props) {
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [draft, setDraft] = useState(customPrompt?.promptText ?? defaultPromptText);
  const [name, setName] = useState(customPrompt?.promptName ?? "Custom audit prompt");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function save() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const r = await saveClientPrompt({
        clientId,
        promptText: draft,
        promptName: name,
      });
      if (r.ok) {
        setSuccess(`Custom prompt saved (v${r.versionNo}). Future audits for ${clientName} will use it.`);
        setMode("preview");
      } else {
        setError(r.error ?? "Save failed.");
      }
    });
  }

  function resetToDefault() {
    if (!confirm("Reset to the generated default prompt? Your custom prompt will be deactivated.")) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const r = await resetClientPromptToDefault({ clientId });
      if (r.ok) {
        setDraft(defaultPromptText);
        setSuccess("Reverted to generated default. Audits will rebuild the prompt from active parameters each time.");
        setMode("preview");
      } else {
        setError(r.error ?? "Reset failed.");
      }
    });
  }

  const displayedText = mode === "edit" ? draft : (customPrompt?.promptText ?? defaultPromptText);

  return (
    <section className="html-card overflow-hidden">
      <div className="html-section-header flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
            <FileText className="h-4 w-4" /> Audit Prompt
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
            {customPrompt ? `Custom · v${customPrompt.versionNo}` : "Default (generated)"}
          </span>
          {mode === "preview" ? (
            <button
              type="button"
              onClick={() => {
                setDraft(customPrompt?.promptText ?? defaultPromptText);
                setMode("edit");
                setError(null);
                setSuccess(null);
              }}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit prompt
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setMode("preview");
                setError(null);
              }}
              disabled={pending}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <Eye className="h-3.5 w-3.5" /> Cancel
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {mode === "edit" ? (
          <>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Prompt name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">
                Prompt text (use placeholders below for injection points)
              </span>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                rows={28}
                className="w-full rounded-lg border border-slate-200 bg-white p-3 text-[12px] font-mono leading-relaxed text-slate-700"
              />
            </label>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-semibold text-slate-700 mb-1.5">Placeholders</p>
              <ul className="grid grid-cols-1 gap-y-0.5 sm:grid-cols-2">
                {[
                  "{{CLIENT_NAME}}",
                  "{{CALL_METADATA}}",
                  "{{PARAMETERS}}",
                  "{{TRANSCRIPT_SEGMENTS}}",
                  "{{JSON_SCHEMA}}",
                  "{{BINARY_SCORING_RULES}}",
                ].map((p) => (
                  <li key={p}>
                    <code className="font-mono">{p}</code>
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                If you forget <code className="font-mono">{"{{PARAMETERS}}"}</code>,{" "}
                <code className="font-mono">{"{{TRANSCRIPT_SEGMENTS}}"}</code>,{" "}
                <code className="font-mono">{"{{JSON_SCHEMA}}"}</code>, or{" "}
                <code className="font-mono">{"{{BINARY_SCORING_RULES}}"}</code>, the audit pipeline
                appends them automatically so audits cannot be silently broken.
              </p>
            </div>
          </>
        ) : (
          <pre className="max-h-[520px] overflow-y-auto whitespace-pre-wrap wrap-break-word rounded-lg border border-slate-200 bg-slate-50 p-3 text-[12px] leading-relaxed font-mono text-slate-700">
            {displayedText}
          </pre>
        )}

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 inline-flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
          </div>
        ) : null}
        {success ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 inline-flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> {success}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {customPrompt ? (
            <button
              type="button"
              onClick={resetToDefault}
              disabled={pending}
              className="inline-flex h-10 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset to generated default
            </button>
          ) : null}
          {mode === "edit" ? (
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="inline-flex h-10 items-center gap-1 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" /> {pending ? "Saving…" : "Save prompt"}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
