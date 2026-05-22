"use client";

import * as React from "react";
import { toast } from "sonner";

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
import { EditAgentDialog } from "@/features/agents/components/edit-agent-dialog";
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
  const [isEditOpen, setIsEditOpen] = React.useState(false);
  const [editingAgent, setEditingAgent] = React.useState<AgentTableRow | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [busyAgentId, setBusyAgentId] = React.useState<string | null>(null);

  const filteredAgents = React.useMemo(() => {
    return agents.filter((agent) => {
      if (statusFilter === "active") return agent.isActive;
      if (statusFilter === "inactive") return !agent.isActive;
      return true;
    });
  }, [agents, statusFilter]);

  const handleToggle = React.useCallback((agent: AgentTableRow) => {
    setBusyAgentId(agent.id);
    startTransition(async () => {
      const result = await toggleAgentActive(agent.id, !agent.isActive);
      setBusyAgentId(null);
      if (result.ok) {
        toast.success(result.message ?? "Agent updated successfully.");
        return;
      }

      toast.error(result.error ?? "Failed to update agent.");
    });
  }, []);

  const handleDelete = React.useCallback((agent: AgentTableRow) => {
    const confirmed = window.confirm(
      "Delete this agent? This is only allowed if there is no call history.",
    );
    if (!confirmed) return;

    setBusyAgentId(agent.id);
    startTransition(async () => {
      const result = await deleteAgent(agent.id);
      setBusyAgentId(null);
      if (result.ok) {
        toast.success(result.message ?? "Agent deleted successfully.");
        return;
      }

      toast.error(
        result.error ??
          "This agent has call history and cannot be deleted. Deactivate the agent instead.",
      );
    });
  }, []);

  const handleEdit = React.useCallback((agent: AgentTableRow) => {
    setEditingAgent(agent);
    setIsEditOpen(true);
  }, []);

  const columns = React.useMemo(
    () =>
      getAgentsTableColumns({
        busyAgentId,
        onDelete: handleDelete,
        onEdit: handleEdit,
        onToggle: handleToggle,
        pending,
      }),
    [busyAgentId, handleDelete, handleEdit, handleToggle, pending],
  );
  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4">
        <AgentsFilterBar
          status={statusFilter}
          onStatusChange={setStatusFilter}
          onAddAgent={() => setIsAddOpen(true)}
        />

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
                tableClassName="min-w-[1120px] table-fixed"
              />
            </div>
          )}
        </section>

        <AddAgentDialog
          isOpen={isAddOpen}
          onOpenChange={setIsAddOpen}
          campaigns={campaigns}
        />
        <EditAgentDialog
          isOpen={isEditOpen}
          onOpenChange={(open) => {
            setIsEditOpen(open);
            if (!open) setEditingAgent(null);
          }}
          agent={editingAgent}
          campaigns={campaigns}
        />
      </div>
    </TooltipProvider>
  );
}
