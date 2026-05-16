"use client";

import { useState, useTransition } from "react";
import { saveManualReview } from "./actions";
import { ClipboardCheck } from "lucide-react";

interface Initial {
  reviewerName: string | null;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  score: number | null;
  notes: string | null;
  disposition: string | null;
}

export function ManualReviewForm({ callId, initial }: { callId: string; initial: Initial }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        await saveManualReview(formData);
        setMessage("Manual review saved.");
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }

  return (
    <article className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-3">
        <ClipboardCheck className="h-4 w-4" /> Manual Review
      </div>
      <form action={submit} className="space-y-3">
        <input type="hidden" name="callId" value={callId} />
        <FormRow label="Reviewer name">
          <input
            name="reviewerName"
            defaultValue={initial.reviewerName ?? ""}
            required
            placeholder="e.g. Sandra (QA)"
            className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
          />
        </FormRow>
        <div className="grid grid-cols-2 gap-3">
          <FormRow label="Status">
            <select
              name="status"
              defaultValue={initial.status}
              className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm bg-white"
            >
              <option value="PENDING">Pending</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </FormRow>
          <FormRow label="Disposition">
            <select
              name="disposition"
              defaultValue={initial.disposition ?? ""}
              className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm bg-white"
            >
              <option value="">—</option>
              <option value="Good">Good</option>
              <option value="Moderate">Moderate</option>
              <option value="Bad">Bad</option>
            </select>
          </FormRow>
        </div>
        <FormRow label="Manual score (0–100)">
          <input
            name="score"
            type="number"
            min={0}
            max={100}
            step={1}
            defaultValue={initial.score ?? ""}
            placeholder="—"
            className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
          />
        </FormRow>
        <FormRow label="Reviewer notes">
          <textarea
            name="notes"
            rows={3}
            defaultValue={initial.notes ?? ""}
            placeholder="Short notes for this review…"
            className="w-full rounded-lg border border-slate-200 p-2 text-sm"
          />
        </FormRow>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save review"}
          </button>
          {message ? <span className="text-xs text-emerald-600">{message}</span> : null}
          {error ? <span className="text-xs text-red-600">{error}</span> : null}
        </div>
        <p className="text-[11px] text-slate-500">
          Final score = manual score (if set), otherwise AI score.
        </p>
      </form>
    </article>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
