"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
} from "lucide-react";

import { DataTable } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/ui/page-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  deleteAgent,
  toggleAgentActive,
} from "@/features/agents/actions/agents";
import type {
  AgentCampaignOption,
  AgentTableRow,
} from "@/features/agents/api/agents";
import { AddAgentDialog } from "@/features/agents/components/add-agent-dialog";
import {
  agentsColumnLabels,
  getAgentsTableColumns,
} from "@/features/agents/components/agents-table-columns";
import {
  AgentsFilterBar,
  type AgentStatusFilter,
} from "@/features/agents/components/filter-bar";

export function AgentsTable({
  agents,
  campaigns,
}: {
  agents: AgentTableRow[];
  campaigns: AgentCampaignOption[];
}) {
  const [statusFilter, setStatusFilter] = React.useState<AgentStatusFilter>("all");
  const [isAddOpen, setIsAddOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [busyAgentId, setBusyAgentId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const filteredAgents = React.useMemo(() => {
    return agents.filter((agent) => {
      if (statusFilter === "active") return agent.isActive;
      if (statusFilter === "inactive") return !agent.isActive;
      return true;
    });
  }, [agents, statusFilter]);

  const handleToggle = React.useCallback((agent: AgentTableRow) => {
    setNotice(null);
    setBusyAgentId(agent.id);
    startTransition(async () => {
      const result = await toggleAgentActive(agent.id, !agent.isActive);
      setBusyAgentId(null);
      setNotice({
        tone: result.ok ? "success" : "error",
        text: result.message ?? result.error ?? "Failed to update agent.",
      });
    });
  }, []);

  const handleDelete = React.useCallback((agent: AgentTableRow) => {
    setNotice(null);
    const confirmed = window.confirm(
      "Delete this agent? This is only allowed if there is no call history.",
    );
    if (!confirmed) return;

    setBusyAgentId(agent.id);
    startTransition(async () => {
      const result = await deleteAgent(agent.id);
      setBusyAgentId(null);
      setNotice({
        tone: result.ok ? "success" : "error",
        text:
          result.message ??
          result.error ??
          "This agent has call history and cannot be deleted. Deactivate the agent instead.",
      });
    });
  }, []);

  const columns = React.useMemo(
    () =>
      getAgentsTableColumns({
        busyAgentId,
        onDelete: handleDelete,
        onToggle: handleToggle,
        pending,
      }),
    [busyAgentId, handleDelete, handleToggle, pending],
  );
  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4">
        <AgentsFilterBar
          status={statusFilter}
          onStatusChange={setStatusFilter}
          onAddAgent={() => setIsAddOpen(true)}
        />

        {notice ? (
          <div
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
              notice.tone === "success"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {notice.tone === "success" ? (
              <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{notice.text}</span>
          </div>
        ) : null}

        <section className="html-card overflow-hidden">
          {agents.length === 0 ? (
            <EmptyState
              className="m-4"
              title="No agents found"
              description="Add your first agent to make them available for audits."
            />
          ) : (
            <div className="p-4">
              <DataTable
                columns={columns}
                data={filteredAgents}
                getRowId={(row) => row.id}
                initialColumnVisibility={{ searchText: false }}
                initialSorting={[{ id: "name", desc: false }]}
                searchColumnId="searchText"
                searchPlaceholder="Search agents, IDs, teams..."
                columnLabels={agentsColumnLabels}
                emptyMessage="No agents match the current table filters."
                itemLabel="agents"
                showFilteredCount={false}
                tableClassName="min-w-[1120px]"
              />
            </div>
          )}
        </section>

        <AddAgentDialog
          isOpen={isAddOpen}
          onOpenChange={setIsAddOpen}
          campaigns={campaigns}
        />
      </div>
    </TooltipProvider>
  );
}
