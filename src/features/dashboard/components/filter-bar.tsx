"use client";

import { format } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition, useState } from "react";

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

interface Options {
  campaigns: { id: string; name: string }[];
  agents: { id: string; name: string; teamId: string | null }[];
}

interface Initial {
  campaignId?: string;
  agentId?: string;
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
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);

  const campaignId = sp.get("campaignId") ?? initial.campaignId ?? "";
  const agentId = sp.get("agentId") ?? initial.agentId ?? "";
  const fromDate = parseDateParam(sp.get("from")) ?? initial.from;
  const toDate = parseDateParam(sp.get("to")) ?? initial.to;
  const visibleAgents = options.agents;

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
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Field>
          <Popover open={fromOpen} onOpenChange={setFromOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                id="from-date"
                className="justify-start bg-white font-normal"
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
                className="justify-start bg-white font-normal"
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

        <div className="flex items-end">
          <Button
            type="button"
            onClick={reset}
            disabled={pending}
            variant="outline"
            className="w-full"
          >
            Clear filters
          </Button>
        </div>
      </div>
    </section>
  );
}
