"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { SlidersHorizontal } from "lucide-react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UploadCallsDialog } from "./upload-calls-dialog";
import type { CallUploadOptions } from "./upload-calls-dialog";

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
  uploadOptions
}: {
  options: Options;
  initial: Initial;
  className?: string;
  uploadOptions: CallUploadOptions
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
    <section className={cn("", className)}>
      {/* <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
            <SlidersHorizontal className="h-4 w-4 text-slate-500" />
            Filters
          </div>
          <p className="text-sm text-slate-500">Narrow the call list by date, team, agent, sentiment, or audit status.</p>
        </div>
        <UploadCallsDialog
          options={uploadOptions}
          maxFileMb={Number(process.env.MAX_AUDIO_UPLOAD_MB ?? "100") || 100}
        />
      </div> */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
                  applyParam("from", toDateInput(date))
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
        </Field>
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
                  applyParam("to", toDateInput(date))
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
            onValueChange={(value) => applyParam("campaignId", value)}>
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
        </Field>

        <Field>
          <FieldLabel htmlFor="select-team">Team</FieldLabel>
          <Select
            defaultValue={initial.teamId ?? ""}
            onValueChange={(value) => applyParam("teamId", value)}
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
        </Field>
        <Field>
          <FieldLabel htmlFor="select-agent">Agents</FieldLabel>
          <Select
            defaultValue={initial.agentId ?? ""}
            onValueChange={(value) => applyParam("agentId", value)}
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
        <Button
          type="button"
          onClick={reset}
          disabled={pending}
          variant={"outline"}
        >
          Clear
        </Button>
        <UploadCallsDialog
          options={uploadOptions}
          maxFileMb={Number(process.env.MAX_AUDIO_UPLOAD_MB ?? "100") || 100}
        />
      </div>
    </section>
  );
}
