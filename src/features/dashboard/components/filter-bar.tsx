"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { Field, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

  const [startDate, setStartDate] = useState<Date>()
  const [endDate, setEndDate] = useState<Date>()

  const [fromOpen, setFromOpen] = useState(false)
  const [toOpen, setToOpen] = useState(false)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

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
    <section className={cn("rounded-xl border border-slate-200 bg-white p-4", className)}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Field>
          <FieldLabel htmlFor="from-date">From</FieldLabel>
          <Popover open={fromOpen} onOpenChange={setFromOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                id="from-date"
                className="justify-start font-normal"
              >
                {startDate ? format(startDate, "PPP") : <span>Pick a date</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={startDate}
                defaultMonth={startDate}
                onSelect={(date) => {
                  if (!date) return
                  setStartDate(date)
                  update("from", toDateInput(date))
                  setFromOpen(false)

                  // optional: auto-fix end date if it becomes invalid
                  if (endDate && date > endDate) {
                    setEndDate(undefined)
                  }
                }}
                disabled={(date) => date > today}
              />
            </PopoverContent>
          </Popover>
          {/* <input
            type="date"
            defaultValue={toDateInput(initial.from)}
            onChange={(e) => update("from", e.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
          /> */}
        </Field>
        {/* <input
            type="date"
            defaultValue={toDateInput(initial.to)}
            onChange={(e) => update("to", e.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
          /> */}
        <Field>
          <FieldLabel htmlFor="to-date">To</FieldLabel>

          <Popover open={toOpen} onOpenChange={setToOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                id="to-date"
                className="justify-start font-normal"
              >
                {endDate ? format(endDate, "PPP") : <span>Pick a date</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={endDate}
                defaultMonth={endDate}
                onSelect={(date) => {
                  if (!date) return
                  setEndDate(date)
                  update("to", toDateInput(date))
                  setToOpen(false)
                }}
                disabled={(date) =>
                  (startDate ? date < startDate : false) || date > today
                }
              />
            </PopoverContent>
          </Popover>
        </Field>
        <Field>
          <FieldLabel htmlFor="campaign">Campaign</FieldLabel>
          <Select
            defaultValue={initial.campaignId ?? ""}
            onValueChange={(value) => update("campaignId", value)}>
            <SelectTrigger id="campaign">
              <SelectValue placeholder="All campaigns" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {options.campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {/* <select
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
          </select> */}
        </Field>
        <Field>

          <FieldLabel htmlFor="select-team">Team</FieldLabel>
          <Select
            defaultValue={initial.teamId ?? ""}
            onValueChange={(value) => update("teamId", value)}
          >
            <SelectTrigger id="select-team">
              <SelectValue placeholder="All Teams" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {options.teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {/* <select
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
          </select> */}
        </Field>
        <Field>
          <FieldLabel htmlFor="select-agent">Agents</FieldLabel>
          <Select
            defaultValue={initial.agentId ?? ""}
            onValueChange={(value) => update("agentId", value)}
          >
            <SelectTrigger id="select-agent">
              <SelectValue placeholder="All Agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {options.agents.map((agent) => (
                  <SelectItem key={agent.id} value={agent.id}>
                    {agent.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {/* <select
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
          </select> */}
        </Field>
        <div className="flex items-end">
          <Button
            type="button"
            onClick={reset}
            disabled={pending}
            variant={"outline"}
          >
            Clear filters
          </Button>
          {/* <button
            type="button"
            onClick={reset}
            disabled={pending}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
          >
            Clear filters
          </button> */}
        </div>
      </div>
    </section>
  );
}

// function Field({ label, children }: { label: string; children: React.ReactNode }) {
//   return (
//     <div className="min-w-0">
//       <label className="mb-1.5 block text-xs text-slate-500">{label}</label>
//       {children}
//     </div>
//   );
// }
