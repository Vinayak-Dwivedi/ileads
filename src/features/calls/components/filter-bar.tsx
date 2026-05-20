"use client";

import { format } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { UploadCallsDialog, type CallUploadOptions } from "./upload-calls-dialog";

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
  // manualDisposition?: string;
  from?: Date;
  to?: Date;
}

function parseDateParam(value: string | null): Date | undefined {
  if (!value) return undefined;

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function toDateParam(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function CallsFilterBar({
  options,
  initial,
  className,
  uploadOptions,
  maxFileMb,
}: {
  options: Options;
  initial: Initial;
  className?: string;
  uploadOptions: CallUploadOptions;
  maxFileMb: number;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);

  const campaignId = sp.get("campaignId") ?? initial.campaignId ?? "";
  const teamId = sp.get("teamId") ?? initial.teamId ?? "";
  const agentId = sp.get("agentId") ?? initial.agentId ?? "";
  const sentiment = sp.get("sentiment") ?? initial.sentiment ?? "";
  const auditStatus = sp.get("auditStatus") ?? initial.auditStatus ?? "";
  //const disposition = sp.get("disposition") ?? initial.manualDisposition ?? "";
  const fromDate = parseDateParam(sp.get("from")) ?? initial.from;
  const toDate = parseDateParam(sp.get("to")) ?? initial.to;
  const visibleAgents = teamId
    ? options.agents.filter((agent) => agent.teamId === teamId)
    : options.agents;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function update(values: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp);

    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }

    const query = next.toString();
    startTransition(() => {
      router.replace(query ? `?${query}` : "?", { scroll: false });
    });
  }

  function handleTeamChange(value: string) {
    const next: Record<string, string | undefined> = { teamId: value };
    const selectedAgentStillVisible = options.agents.some(
      (agent) => agent.id === agentId && agent.teamId === value,
    );

    if (agentId && value && !selectedAgentStillVisible) {
      next.agentId = undefined;
    }

    update(next);
  }

  function handleFromDateChange(date: Date | undefined) {
    if (!date) return;

    const next: Record<string, string | undefined> = { from: toDateParam(date) };
    if (toDate && date > toDate) {
      next.to = undefined;
    }

    update(next);
    setFromOpen(false);
  }

  function handleToDateChange(date: Date | undefined) {
    if (!date) return;

    update({ to: toDateParam(date) });
    setToOpen(false);
  }

  function reset() {
    startTransition(() => router.replace("?", { scroll: false }));
  }

  return (
    <section className={cn("rounded-xl border border-slate-200 bg-white p-4", className)}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field>
          <Popover open={fromOpen} onOpenChange={setFromOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                id="from-date"
                className="w-full justify-start bg-white font-normal"
              >
                {fromDate ? format(fromDate, "PPP") : <span>From date</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={fromDate}
                defaultMonth={fromDate}
                onSelect={handleFromDateChange}
                disabled={(date) => date > today}
              />
            </PopoverContent>
          </Popover>
        </Field>

        <Field>
          <Popover open={toOpen} onOpenChange={setToOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                id="to-date"
                className="w-full justify-start bg-white font-normal"
              >
                {toDate ? format(toDate, "PPP") : <span>To date</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={toDate}
                defaultMonth={toDate ?? fromDate}
                onSelect={handleToDateChange}
                disabled={(date) => (fromDate ? date < fromDate : false) || date > today}
              />
            </PopoverContent>
          </Popover>
        </Field>

        <Field>
          <Select
            value={campaignId}
            onValueChange={(value) => update({ campaignId: value })}
          >
            <SelectTrigger id="campaign" className="w-full bg-white">
              <SelectValue placeholder="All campaigns" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {options.campaigns.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <Select value={teamId} onValueChange={handleTeamChange}>
            <SelectTrigger id="select-team" className="w-full bg-white">
              <SelectValue placeholder="All teams" />
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
          <Select value={agentId} onValueChange={(value) => update({ agentId: value })}>
            <SelectTrigger id="select-agent" className="w-full bg-white">
              <SelectValue placeholder="All agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {visibleAgents.map((agent) => (
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
          <Select value={sentiment} onValueChange={(value) => update({ sentiment: value })}>
            <SelectTrigger id="select-sentiment" className="w-full bg-white">
              <SelectValue placeholder="Sentiments" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="POSITIVE">Positive</SelectItem>
                <SelectItem value="NEUTRAL">Neutral</SelectItem>
                <SelectItem value="NEGATIVE">Negative</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <Select
            value={auditStatus}
            onValueChange={(value) => update({ auditStatus: value })}
          >
            <SelectTrigger id="select-audit-status" className="w-full bg-white">
              <SelectValue placeholder="Audit status" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="AUDITED">Audited</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="IN_REVIEW">In Review</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        {/* <Field>
          <Select
            value={disposition}
            onValueChange={(value) => update({ disposition: value })}
          >
            <SelectTrigger id="select-disposition" className="w-full bg-white">
              <SelectValue placeholder="All dispositions" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="Good">Good</SelectItem>
                <SelectItem value="Moderate">Moderate</SelectItem>
                <SelectItem value="Bad">Bad</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field> */}

        <Button
          type="button"
          onClick={reset}
          disabled={pending}
          variant="outline"
          className="w-full"
        >
          Clear
        </Button>

        <div className="w-full lg:col-start-5 [&>button]:w-full">
          <UploadCallsDialog options={uploadOptions} maxFileMb={maxFileMb} />
        </div>
      </div>
    </section>
  );
}
