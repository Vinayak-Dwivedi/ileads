"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Pencil, Trash2, Plus, Search, Power } from "lucide-react";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/page-shell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteParameter, toggleParameterActive, upsertParameter } from "./actions";

interface ParameterRow {
  id: string;
  parameterCategory: string;
  parameterName: string;
  parameterDescription: string;
  maxScore: number;
  aiInstruction: string;
  displayOrder: number;
  isActive: boolean;
  scoreCount: number;
}

interface Props {
  clientId: string;
  clients: { id: string; name: string }[];
  categories: string[];
  parameters?: ParameterRow[];
  initialSearch?: string;
  initialCategory?: string;
  trigger?: React.ReactNode;
}

export function ParameterEditor({
  clientId,
  clients,
  categories,
  parameters = [],
  initialSearch = "",
  initialCategory = "",
  trigger,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(initialSearch);
  const [editing, setEditing] = useState<ParameterRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<
    | { kind: "success" | "error"; message: string }
    | null
  >(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!banner || banner.kind !== "success") return;
    const t = setTimeout(() => setBanner(null), 3500);
    return () => clearTimeout(t);
  }, [banner]);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`?${next.toString()}`, { scroll: false }));
  }

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    updateParam("q", search);
  }

  function openCreate() {
    setEditing(null);
    setError(null);
    setModalOpen(true);
  }
  function openEdit(p: ParameterRow) {
    setEditing(p);
    setError(null);
    setModalOpen(true);
  }

  function submitForm(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await upsertParameter(formData);
      if (result.ok) {
        setModalOpen(false);
        setBanner({ kind: "success", message: editing ? "Parameter updated." : "Parameter added." });
        router.refresh();
      } else {
        setError(result.error ?? "Failed to save parameter.");
      }
    });
  }

  function onToggle(id: string, isActive: boolean) {
    const fd = new FormData();
    fd.set("id", id);
    setBusyId(id);
    startTransition(async () => {
      const result = await toggleParameterActive(fd);
      setBusyId(null);
      if (result.ok) {
        setBanner({
          kind: "success",
          message: isActive ? "Parameter deactivated." : "Parameter activated.",
        });
        router.refresh();
      } else {
        setBanner({ kind: "error", message: result.error ?? "Failed to update parameter." });
      }
    });
  }

  function onDelete(p: ParameterRow) {
    if (p.scoreCount > 0) {
      setBanner({
        kind: "error",
        message:
          "This parameter has audit history and cannot be deleted. Deactivate it instead.",
      });
      return;
    }
    if (!confirm(`Delete "${p.parameterName}"? This cannot be undone.`)) return;
    const fd = new FormData();
    fd.set("id", p.id);
    setBusyId(p.id);
    startTransition(async () => {
      const result = await deleteParameter(fd);
      setBusyId(null);
      if (result.ok) {
        setBanner({ kind: "success", message: `Deleted "${p.parameterName}".` });
        router.refresh();
      } else {
        setBanner({
          kind: "error",
          message: result.error ?? "Failed to delete parameter.",
        });
      }
    });
  }

  const grouped = useMemo(() => {
    const map = new Map<string, ParameterRow[]>();
    for (const p of parameters) {
      const arr = map.get(p.parameterCategory) ?? [];
      arr.push(p);
      map.set(p.parameterCategory, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [parameters]);

  return (
    <>
      <section className="html-card mb-4 p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Parameter Filters</h3>
          <p className="text-sm text-slate-500">Search active and inactive parameter definitions for this client.</p>
        </div>
        <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
          <div>
            <label className="mb-1.5 ml-1 block text-[13px] text-[#5f6777]">Process</label>
            <select
              value=""
              disabled
              className="html-select w-full px-2 disabled:bg-white disabled:text-slate-500"
            >
              <option>All Processes</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 ml-1 block text-[13px] text-[#5f6777]">Campaign</label>
            <select
              value={clientId}
              disabled
              className="html-select w-full px-2 disabled:bg-white disabled:text-slate-500"
            >
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 ml-1 block text-[13px] text-[#5f6777]">Parameters</label>
            <form onSubmit={submitSearch} className="flex html-select items-center px-3">
              <Search className="mr-2 h-4 w-4 flex-none text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, description, category"
                className="flex-1 border-0 outline-none text-sm bg-transparent"
              />
            </form>
          </div>
          <div>
            <label className="mb-1.5 ml-1 block text-[13px] text-[#5f6777]">Category</label>
            <select
              defaultValue={initialCategory}
              onChange={(e) => updateParam("category", e.target.value)}
              className="html-select w-full px-2"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {banner ? (
        <div
          role="status"
          className={
            "mb-3 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm " +
            (banner.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800")
          }
        >
          <span>{banner.message}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="ml-2 text-xs font-medium opacity-70 hover:opacity-100"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ) : null}

      <section className="html-card overflow-hidden">
        <div className="html-section-header flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Parameters</h3>
            <p className="text-xs text-slate-500">Grouped by the 10 standard QMS KPI categories.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[13px] font-semibold text-slate-700">
              Total: {parameters.reduce((sum, p) => sum + (p.isActive ? p.maxScore : 0), 0)}
            </div>
            {trigger ? (
              <span onClick={openCreate}>{trigger}</span>
            ) : (
              <button
                onClick={openCreate}
                className="html-btn html-btn-primary h-10"
              >
                <Plus className="h-4 w-4" /> Add Parameters
              </button>
            )}
          </div>
        </div>

        {parameters.length === 0 ? (
          <EmptyState
            className="m-4"
            title="No parameters match"
            description="Adjust your filters or add a new parameter."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <colgroup>
                <col style={{ width: "18%" }} />
                <col style={{ width: "62%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "12%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="html-table-head text-center">Standard KPI</th>
                  <th className="html-table-head text-center">Sub Parameters</th>
                  <th className="html-table-head text-center">Score</th>
                  <th className="html-table-head text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map(([cat, rows]) => (
                  <CategoryGroup
                    key={cat}
                    category={cat}
                    rows={rows}
                    onEdit={openEdit}
                    onToggle={onToggle}
                    onDelete={onDelete}
                    pending={pending}
                    busyId={busyId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modalOpen ? (
        <ParameterFormModal
          clientId={clientId}
          clients={clients}
          categories={categories}
          editing={editing}
          error={error}
          pending={pending}
          onCancel={() => setModalOpen(false)}
          onSubmit={submitForm}
        />
      ) : null}
    </>
  );
}

function CategoryGroup({
  category,
  rows,
  onEdit,
  onToggle,
  onDelete,
  pending,
  busyId,
}: {
  category: string;
  rows: ParameterRow[];
  onEdit: (p: ParameterRow) => void;
  onToggle: (id: string, isActive: boolean) => void;
  onDelete: (p: ParameterRow) => void;
  pending: boolean;
  busyId: string | null;
}) {
  return (
    <>
      {rows.map((p, idx) => {
        const hasHistory = p.scoreCount > 0;
        const isBusy = busyId === p.id;
        return (
          <tr key={p.id} className="hover:bg-slate-50">
            {idx === 0 ? (
              <td rowSpan={rows.length} className="border-b border-slate-100 bg-slate-50 px-3 py-3 text-center align-middle font-semibold text-slate-900">
                {category}
              </td>
            ) : null}
            <td className="html-table-cell whitespace-normal">
              <div className="font-medium text-slate-800">{p.parameterName}</div>
              <div className="text-xs text-slate-500 mt-1 max-w-2xl">{p.parameterDescription}</div>
              {p.aiInstruction ? (
                <div className="text-[11px] text-slate-400 mt-1">AI: {p.aiInstruction}</div>
              ) : null}
              {hasHistory ? (
                <div className="text-[11px] text-amber-700 mt-1">
                  Used in {p.scoreCount} audit{p.scoreCount === 1 ? "" : "s"} — deactivate instead of delete.
                </div>
              ) : null}
            </td>
            <td className="html-table-cell text-center font-mono text-slate-700">{p.maxScore}</td>
            <td className="html-table-cell text-center">
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => onEdit(p)}
                  className="grid h-7 w-7 place-items-center rounded-full border border-[#cfd7e5] bg-white text-[#3559eb] hover:bg-slate-50"
                  title="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onToggle(p.id, p.isActive)}
                  disabled={pending}
                  className="grid h-7 w-7 place-items-center rounded-full border border-[#cfd7e5] bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  title={p.isActive ? "Deactivate" : "Activate"}
                >
                  <Power className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onDelete(p)}
                  disabled={pending || hasHistory}
                  className="grid h-7 w-7 place-items-center rounded-full border border-[#cfd7e5] bg-white text-red-500 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={
                    hasHistory
                      ? "Used in audit history. Deactivate instead."
                      : isBusy
                        ? "Deleting…"
                        : "Delete"
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-2">
                <Pill tone={p.isActive ? "green" : "slate"}>{p.isActive ? "Active" : "Inactive"}</Pill>
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function ParameterFormModal({
  clientId,
  clients,
  categories,
  editing,
  error,
  pending,
  onCancel,
  onSubmit,
}: {
  clientId: string;
  clients: { id: string; name: string }[];
  categories: string[];
  editing: ParameterRow | null;
  error: string | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (fd: FormData) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-lg font-semibold text-slate-900">
            {editing ? "Edit Parameter" : "Add Parameter"}
          </h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            ✕
          </button>
        </div>
        <form action={onSubmit} className="space-y-3 p-5">
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <Row label="Client">
            <select
              name="clientId"
              defaultValue={clientId}
              required
              className="h-10 w-full rounded-lg border border-[#d6dcea] bg-white px-2 text-sm"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Standard KPI category">
            <Select name="parameterCategory" defaultValue={editing?.parameterCategory ?? "Opening / Greeting"} required>
              <SelectTrigger className="h-10 w-full rounded-lg border border-[#d6dcea] px-3 text-sm bg-white hover:bg-slate-50 focus:ring-1 focus:ring-blue-500 shadow-sm transition-all">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Opening / Greeting">Opening / Greeting</SelectItem>
                <SelectItem value="Customer Verification">Customer Verification</SelectItem>
                <SelectItem value="Call Purpose Identification">Call Purpose Identification</SelectItem>
                <SelectItem value="Communication Skills">Communication Skills</SelectItem>
                <SelectItem value="Listening & Probing">Listening & Probing</SelectItem>
                <SelectItem value="Empathy & Courtesy">Empathy & Courtesy</SelectItem>
                <SelectItem value="Product / Process Knowledge">Product / Process Knowledge</SelectItem>
                <SelectItem value="Resolution / Assistance Quality">Resolution / Assistance Quality</SelectItem>
                <SelectItem value="Compliance">Compliance</SelectItem>
                <SelectItem value="Closing & Documentation">Closing & Documentation</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <p className="-mt-1 text-xs text-slate-500">
            Choose one of the 10 standard KPI buckets used by the audit scorecards.
          </p>
          <Row label="Sub Parameter (e.g. Greeting, Empathy)">
            <input
              name="parameterName"
              defaultValue={editing?.parameterName ?? ""}
              required
              className="h-10 w-full rounded-lg border border-[#d6dcea] px-3 text-sm"
              placeholder="Write your sub parameter here"
            />
          </Row>
          <Row label="Description">
            <textarea
              name="parameterDescription"
              defaultValue={editing?.parameterDescription ?? ""}
              required
              rows={2}
              className="w-full rounded-lg border border-[#d6dcea] p-2 text-sm"
            />
          </Row>
          <Row label="AI instruction (optional)">
            <textarea
              name="aiInstruction"
              defaultValue={editing?.aiInstruction ?? ""}
              rows={2}
              placeholder="Tell the AI exactly when to mark this as fulfilled."
              className="w-full rounded-lg border border-[#d6dcea] p-2 text-sm"
            />
          </Row>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Max score">
              <input
                name="maxScore"
                type="number"
                min={1}
                step={1}
                defaultValue={editing?.maxScore ?? 10}
                required
                className="h-10 w-full rounded-lg border border-[#d6dcea] px-3 text-sm"
              />
            </Row>
            <Row label="Display order">
              <input
                name="displayOrder"
                type="number"
                step={1}
                defaultValue={editing?.displayOrder ?? 0}
                required
                className="h-10 w-full rounded-lg border border-[#d6dcea] px-3 text-sm"
              />
            </Row>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={editing ? editing.isActive : true}
              className="rounded border-slate-300"
            />
            <span className="text-slate-700">Active</span>
          </label>
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-500">
            <strong className="text-slate-700">Binary scoring:</strong> if fulfilled, the full max
            score is awarded; otherwise the score is 0.
          </div>
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
              className="h-10 rounded-md bg-blue-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
            >
              {pending ? "Saving…" : editing ? "Save changes" : "Add parameter"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 ml-1 block text-[13px] text-[#5f6777]">{label}</label>
      {children}
    </div>
  );
}
