"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { PencilLineIcon, PowerIcon, Trash2Icon, UserIcon } from "lucide-react";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Pill } from "@/components/ui/pill";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AgentTableRow } from "@/features/agents/api/agents";

export const agentsColumnLabels: Record<string, string> = {
  name: "Agent",
  employeeCode: "Agent ID",
  // email: "Email",
  // teamName: "Team",
  campaignName: "Campaign",
  callCount: "Calls",
  isActive: "Status",
  createdAt: "Date Added",
};

interface AgentActionHandlers {
  busyAgentId: string | null;
  onDelete: (agent: AgentTableRow) => void;
  onEdit: (agent: AgentTableRow) => void;
  onToggle: (agent: AgentTableRow) => void;
  pending: boolean;
}

export function getAgentsTableColumns({
  busyAgentId,
  onDelete,
  onEdit,
  onToggle,
  pending,
}: AgentActionHandlers): ColumnDef<AgentTableRow>[] {
  return [
    {
      accessorKey: "searchText",
      header: () => null,
      cell: () => null,
      enableHiding: false,
      enableSorting: false,
    },
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Agent" />
      ),
      cell: ({ row }) => <AgentNameCell agent={row.original} />,
      enableHiding: false,
      meta: {
        headClassName: "w-[24%]",
        cellClassName: "w-[24%]",
      },
    },
    {
      accessorKey: "employeeCode",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Agent ID" />
      ),
      cell: ({ row }) => (
        <span className="font-mono text-xs font-semibold text-slate-600">
          {row.original.employeeCode ?? row.original.id}
        </span>
      ),
      meta: {
        headClassName: "w-[12%]",
        cellClassName: "w-[12%]",
      },
    },
    // {
    //   accessorKey: "email",
    //   header: ({ column }) => (
    //     <DataTableColumnHeader column={column} title="Email" />
    //   ),
    //   cell: ({ row }) => (
    //     <span className="text-slate-600">{row.original.email ?? "-"}</span>
    //   ),
    // },
    // {
    //   accessorKey: "teamName",
    //   header: ({ column }) => (
    //     <DataTableColumnHeader column={column} title="Team" />
    //   ),
    //   cell: ({ row }) => (
    //     <span className="text-slate-600">{row.original.teamName ?? "-"}</span>
    //   ),
    // },
    {
      accessorKey: "campaignName",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Campaign" />
      ),
      cell: ({ row }) => (
        <span className="text-slate-600">
          {row.original.campaignName ?? "-"}
        </span>
      ),
      meta: {
        headClassName: "w-[18%]",
        cellClassName: "w-[18%]",
      },
    },
    {
      accessorKey: "callCount",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Calls" className="justify-center" />
      ),
      cell: ({ row }) => (
        <div className="text-center font-mono text-sm text-slate-700">
          {row.original.callCount.toLocaleString()}
        </div>
      ),
      meta: {
        headClassName: "w-[8%]",
        cellClassName: "w-[8%]",
      },
    },
    {
      accessorKey: "isActive",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => (
        <Pill tone={row.original.isActive ? "green" : "slate"}>
          {row.original.isActive ? "Active" : "Inactive"}
        </Pill>
      ),
      meta: {
        headClassName: "w-[12%]",
        cellClassName: "w-[12%]",
      },
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Date Added" />
      ),
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.createdAt}
        </span>
      ),
      meta: {
        headClassName: "w-[14%]",
        cellClassName: "w-[14%]",
      },
    },
    {
      id: "actions",
      header: () => <div className="text-right">Actions</div>,
      cell: ({ row }) => (
        <AgentActions
          agent={row.original}
          busy={busyAgentId === row.original.id}
          onDelete={onDelete}
          onEdit={onEdit}
          onToggle={onToggle}
          pending={pending}
        />
      ),
      enableHiding: false,
      enableSorting: false,
      meta: {
        headClassName: "w-[12%]",
        cellClassName: "w-[12%]",
      },
    },
  ];
}

function AgentNameCell({ agent }: { agent: AgentTableRow }) {
  return (
    <div className="flex min-w-48 items-center gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-100 bg-blue-50 text-xs font-semibold text-blue-700">
        {initials(agent.name)}
      </div>
      <div className="min-w-0">
        <div className="font-semibold text-slate-900">{agent.name}</div>
        <div className="text-xs text-muted-foreground">
          {agent.callCount > 0 ? "Has call history" : "No call history"}
        </div>
      </div>
    </div>
  );
}

function AgentActions({
  agent,
  busy,
  onDelete,
  onEdit,
  onToggle,
  pending,
}: {
  agent: AgentTableRow;
  busy: boolean;
  onDelete: (agent: AgentTableRow) => void;
  onEdit: (agent: AgentTableRow) => void;
  onToggle: (agent: AgentTableRow) => void;
  pending: boolean;
}) {
  const hasHistory = agent.callCount > 0;

  return (
    <div className="flex justify-end">
      <ButtonGroup>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={pending}
              onClick={() => onEdit(agent)}
              aria-label="Edit agent"
            >
              <PencilLineIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            Edit agent
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={pending}
              onClick={() => onToggle(agent)}
              aria-label={agent.isActive ? "Deactivate agent" : "Activate agent"}
            >
              <PowerIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {agent.isActive ? "Deactivate agent" : "Activate agent"}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button
                type="button"
                variant="destructive"
                size="icon-sm"
                disabled={pending || hasHistory}
                onClick={() => onDelete(agent)}
                aria-label="Delete agent"
              >
                <Trash2Icon />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {hasHistory
              ? "Call history exists. Deactivate instead."
              : busy
                ? "Deleting..."
                : "Delete agent"}
          </TooltipContent>
        </Tooltip>
      </ButtonGroup>
    </div>
  );
}

function initials(name: string) {
  const value = name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return value || <UserIcon className="h-4 w-4" />;
}
