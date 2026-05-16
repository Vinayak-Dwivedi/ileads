"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";
import { CalendarDays } from "lucide-react";

interface Options {
  campaigns: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  agents: { id: string; name: string; teamId: string | null }[];
}

interface Initial {
  search?: string;
  campaignId?: string;
  teamId?: string;
  agentId?: string;
  sentiment?: string;
  auditStatus?: string;
  manualDisposition?: string;
  from?: Date;
  to?: Date;
}

function toDateInput(d: Date | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

export function CallsFilterBar({
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
  function applyParam(key: string, value: string) {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`?${next.toString()}`, { scroll: false }));
  }

  function reset() {
    startTransition(() => router.replace("?", { scroll: false }));
  }

  return (
    <section className={cn("html-card mb-[22px] p-4", className)}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field>
          <div className="relative">
            <input
              type="date"
              defaultValue={toDateInput(initial.from)}
              onChange={(e) => applyParam("from", e.target.value)}
              className="h-9 w-full rounded-lg border border-[#d6dcea] px-2 pr-8 text-sm"
            />
            <CalendarDays className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-slate-400" />
          </div>
        </Field>
        <Field>
          <div className="relative">
            <input
              type="date"
              defaultValue={toDateInput(initial.to)}
              onChange={(e) => applyParam("to", e.target.value)}
              className="h-9 w-full rounded-lg border border-[#d6dcea] px-2 pr-8 text-sm"
            />
            <CalendarDays className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-slate-400" />
          </div>
        </Field>
        <Field>
          <select
            defaultValue={initial.campaignId ?? ""}
            onChange={(e) => applyParam("campaignId", e.target.value)}
            className="h-9 w-full rounded-lg border border-[#d6dcea] bg-white px-2 text-sm"
          >
            <option value="">All Campaigns</option>
            {options.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <select
            defaultValue={initial.teamId ?? ""}
            onChange={(e) => applyParam("teamId", e.target.value)}
            className="h-9 w-full rounded-lg border border-[#d6dcea] bg-white px-2 text-sm"
          >
            <option value="">All Teams</option>
            {options.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <select
            defaultValue={initial.agentId ?? ""}
            onChange={(e) => applyParam("agentId", e.target.value)}
            className="h-9 w-full rounded-lg border border-[#d6dcea] bg-white px-2 text-sm"
          >
            <option value="">All Agents</option>
            {options.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field>
          <select
            defaultValue={initial.sentiment ?? ""}
            onChange={(e) => applyParam("sentiment", e.target.value)}
            className="h-9 w-full rounded-lg border border-[#d6dcea] bg-white px-2 text-sm"
          >
            <option value="">Sentiments</option>
            <option value="POSITIVE">Positive</option>
            <option value="NEUTRAL">Neutral</option>
            <option value="NEGATIVE">Negative</option>
          </select>
        </Field>
        <Field>
          <select
            defaultValue={initial.auditStatus ?? ""}
            onChange={(e) => applyParam("auditStatus", e.target.value)}
            className="h-9 w-full rounded-lg border border-[#d6dcea] bg-white px-2 text-sm"
          >
            <option value="">Audit Status</option>
            <option value="AUDITED">Audited</option>
            <option value="PENDING">Pending</option>
            <option value="IN_REVIEW">In Review</option>
          </select>
        </Field>
        <Field>
          <select
            defaultValue={initial.manualDisposition ?? ""}
            onChange={(e) => applyParam("disposition", e.target.value)}
            className="h-9 w-full rounded-lg border border-[#d6dcea] bg-white px-2 text-sm"
          >
            <option value="">All Dispositions</option>
            <option value="Good">Good</option>
            <option value="Moderate">Moderate</option>
            <option value="Bad">Bad</option>
          </select>
        </Field>
        <div className="flex items-end">
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            className="html-btn h-9 w-full justify-center"
          >
            Clear
          </button>
        </div>
      </div>
    </section>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      {children}
    </div>
  );
}
