"use client";

import { useState, useTransition } from "react";
import { addCallNote } from "./actions";
import { Pill } from "@/components/ui/pill";
import { MessageSquare } from "lucide-react";
import { formatShortDate, formatTime } from "@/lib/utils";

interface NoteItem {
  id: string;
  author: string;
  body: string;
  isPinned: boolean;
  createdAt: string;
}

export function NotesPanel({ callId, notes }: { callId: string; notes: NoteItem[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await addCallNote(formData);
        (document.getElementById(`note-form-${callId}`) as HTMLFormElement | null)?.reset();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to add note");
      }
    });
  }

  return (
    <article className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-3">
        <MessageSquare className="h-4 w-4" /> Notes
        <span className="ml-auto text-xs font-normal text-slate-500">{notes.length}</span>
      </div>
      <div className="space-y-3 mb-4 max-h-[260px] overflow-y-auto pr-1">
        {notes.length === 0 ? (
          <p className="text-xs text-slate-500">No notes have been added for this call yet.</p>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-700">{n.author}</p>
                {n.isPinned ? <Pill tone="yellow">Pinned</Pill> : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-slate-700">{n.body}</p>
              <p className="text-[11px] text-slate-500 mt-1.5">
                {formatShortDate(n.createdAt)} · {formatTime(n.createdAt)}
              </p>
            </div>
          ))
        )}
      </div>
      <form id={`note-form-${callId}`} action={submit} className="space-y-2">
        <input type="hidden" name="callId" value={callId} />
        <input
          name="authorName"
          required
          placeholder="Your name"
          className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
        />
        <textarea
          name="body"
          required
          rows={2}
          placeholder="Add a note…"
          className="w-full rounded-lg border border-slate-200 p-2 text-sm"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="h-9 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Add note"}
          </button>
          {error ? <span className="text-xs text-red-600">{error}</span> : null}
        </div>
      </form>
    </article>
  );
}
