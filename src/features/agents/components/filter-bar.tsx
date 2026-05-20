"use client";

import { UserPlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type AgentStatusFilter = "all" | "active" | "inactive";

export function AgentsFilterBar({
  className,
  onAddAgent,
  onStatusChange,
  status,
}: {
  className?: string;
  onAddAgent: () => void;
  onStatusChange: (status: AgentStatusFilter) => void;
  status: AgentStatusFilter;
}) {
  return (
    <section className={cn("rounded-xl border border-slate-200 bg-white p-4", className)}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select
          value={status}
          onValueChange={(value) => onStatusChange(value as AgentStatusFilter)}
        >
          <SelectTrigger className="w-full bg-white">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active only</SelectItem>
              <SelectItem value="inactive">Inactive only</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <div className="w-full sm:col-start-2 lg:col-start-5">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onAddAgent}
          >
            <UserPlusIcon data-icon="inline-start" />
            Add Agent
          </Button>
        </div>
      </div>
    </section>
  );
}
