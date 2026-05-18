"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";

interface Options {
  campaigns: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  agents: { id: string; name: string; teamId: string | null }[];
}

interface Initial {
  campaignId?: string;
  teamId?: string;
  agentId?: string;
  from?: Date;
  to?: Date;
}

function toDateInput(d: Date | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

export function DashboardFilterBar({
  options,
  initial,
  className,
}: {
  options: Options;
  initial: Initial;
  className?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: string, value: string) {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`?${next.toString()}`, { scroll: false }));
  }

  function reset() {
    startTransition(() => router.replace("?", { scroll: false }));
  }

  return (
    <section className={cn("rounded-xl border border-slate-200 bg-white p-4 shadow-sm", className)}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Field label="From">
          <input
            type="date"
            defaultValue={toDateInput(initial.from)}
            onChange={(e) => update("from", e.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            defaultValue={toDateInput(initial.to)}
            onChange={(e) => update("to", e.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
          />
        </Field>
        <Field label="Campaign">
          <select
            defaultValue={initial.campaignId ?? ""}
            onChange={(e) => update("campaignId", e.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm bg-white"
          >
            <option value="">All campaigns</option>
            {options.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Team">
          <select
            defaultValue={initial.teamId ?? ""}
            onChange={(e) => update("teamId", e.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm bg-white"
          >
            <option value="">All teams</option>
            {options.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Agent">
          <select
            defaultValue={initial.agentId ?? ""}
            onChange={(e) => update("agentId", e.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm bg-white"
          >
            <option value="">All agents</option>
            {options.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end">
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
          >
            Clear filters
          </button>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="mb-1.5 block text-xs text-slate-500">{label}</label>
      {children}
    </div>
  );
}
