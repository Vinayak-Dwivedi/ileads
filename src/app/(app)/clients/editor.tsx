"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Power } from "lucide-react";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/page-shell";
import { upsertClient, toggleClientActive } from "./actions";

interface ClientRow {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  contactEmail: string | null;
  isActive: boolean;
  counts: { calls: number; agents: number; campaigns: number; parameters: number; teams: number };
}

export function ClientsEditor({
  clients,
  currentClientId,
}: {
  clients: ClientRow[];
  currentClientId: string;
}) {
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setError(null);
    setModalOpen(true);
  }
  function openEdit(c: ClientRow) {
    setEditing(c);
    setError(null);
    setModalOpen(true);
  }

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await upsertClient(formData);
        setModalOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed");
      }
    });
  }

  function onToggle(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(() => {
      void toggleClientActive(fd);
    });
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button
          onClick={openCreate}
          className="h-9 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> Add Client
        </button>
      </div>

      <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">All clients</h3>
          <Pill tone="blue">Total: {clients.length}</Pill>
        </div>
        {clients.length === 0 ? (
          <EmptyState
            className="m-4"
            title="No clients"
            description="Add your first client to start running audits."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2.5 text-left">Name</th>
                  <th className="px-3 py-2.5 text-left">Slug</th>
                  <th className="px-3 py-2.5 text-left">Industry</th>
                  <th className="px-3 py-2.5 text-left">Email</th>
                  <th className="px-3 py-2.5 text-right">Calls</th>
                  <th className="px-3 py-2.5 text-right">Agents</th>
                  <th className="px-3 py-2.5 text-right">Teams</th>
                  <th className="px-3 py-2.5 text-right">Campaigns</th>
                  <th className="px-3 py-2.5 text-right">Parameters</th>
                  <th className="px-3 py-2.5 text-left">Status</th>
                  <th className="px-3 py-2.5 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-3 font-medium text-slate-800">
                      {c.name}
                      {c.id === currentClientId ? (
                        <Pill tone="blue" className="ml-2">Current</Pill>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-slate-500">{c.slug}</td>
                    <td className="px-3 py-3 text-slate-600">{c.industry ?? "—"}</td>
                    <td className="px-3 py-3 text-slate-600">{c.contactEmail ?? "—"}</td>
                    <td className="px-3 py-3 text-right">{c.counts.calls}</td>
                    <td className="px-3 py-3 text-right">{c.counts.agents}</td>
                    <td className="px-3 py-3 text-right">{c.counts.teams}</td>
                    <td className="px-3 py-3 text-right">{c.counts.campaigns}</td>
                    <td className="px-3 py-3 text-right">{c.counts.parameters}</td>
                    <td className="px-3 py-3">
                      <Pill tone={c.isActive ? "green" : "slate"}>{c.isActive ? "Active" : "Inactive"}</Pill>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(c)}
                          className="w-8 h-8 rounded-full border border-slate-200 grid place-items-center text-slate-600 hover:bg-slate-50"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => onToggle(c.id)}
                          disabled={pending}
                          className="w-8 h-8 rounded-full border border-slate-200 grid place-items-center text-slate-600 hover:bg-slate-50"
                          title={c.isActive ? "Deactivate" : "Activate"}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpen ? (
        <ClientFormModal
          editing={editing}
          error={error}
          pending={pending}
          onCancel={() => setModalOpen(false)}
          onSubmit={submit}
        />
      ) : null}
    </>
  );
}

function ClientFormModal({
  editing,
  error,
  pending,
  onCancel,
  onSubmit,
}: {
  editing: ClientRow | null;
  error: string | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (fd: FormData) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-800">{editing ? "Edit Client" : "Add Client"}</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            ✕
          </button>
        </div>
        <form action={onSubmit} className="space-y-3">
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <Field label="Name">
            <input
              name="name"
              defaultValue={editing?.name ?? ""}
              required
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            />
          </Field>
          <Field label="Industry (optional)">
            <input
              name="industry"
              defaultValue={editing?.industry ?? ""}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            />
          </Field>
          <Field label="Contact email (optional)">
            <input
              name="contactEmail"
              type="email"
              defaultValue={editing?.contactEmail ?? ""}
              className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={editing ? editing.isActive : true}
              className="rounded border-slate-300"
            />
            <span className="text-slate-700">Active</span>
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {pending ? "Saving…" : editing ? "Save changes" : "Add client"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
