"use client";

import { DataTable } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/ui/page-shell";
import type { ScoreboardRow } from "@/features/dashboard/api/dashboard";
import {
  agentScoreboardColumnLabels,
  agentScoreboardColumns,
} from "@/features/dashboard/components/agent-scoreboard-columns";

export function AgentScoreboardTable({ data }: { data: ScoreboardRow[] }) {
  if (data.length === 0) {
    return (
      <EmptyState
        title="No agents yet"
        description="Upload and audit calls to populate the scoreboard."
      />
    );
  }

  return (
    <DataTable
      columns={agentScoreboardColumns}
      data={data}
      getRowId={(row) => row.agentId}
      initialSorting={[{ id: "rank", desc: false }]}
      searchPlaceholder="Search agents, IDs, campaigns..."
      columnLabels={agentScoreboardColumnLabels}
      emptyMessage="No agents match the current table filters."
      itemLabel="agents"
    />
  );
}
