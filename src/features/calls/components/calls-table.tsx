"use client";

import { DataTable } from "@/components/data-table/data-table";
import { EmptyState } from "@/components/ui/page-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  callsColumnLabels,
  callsTableColumns,
  type CallsTableRow,
} from "@/features/calls/components/calls-table-columns";

export function CallsTable({ data }: { data: CallsTableRow[] }) {
  if (data.length === 0) {
    return (
      <EmptyState
        className="m-4"
        title="No calls yet"
        description="Upload a call to begin."
      />
    );
  }

  return (
    <TooltipProvider>
      <div className="p-4">
        <DataTable
          columns={callsTableColumns}
          data={data}
          getRowId={(row) => row.id}
          initialColumnVisibility={{ searchText: false }}
          initialPageSize={20}
          initialSorting={[{ id: "startedAtTimestamp", desc: true }]}
          searchColumnId="searchText"
          searchPlaceholder="Search calls, agents, customers..."
          columnLabels={callsColumnLabels}
          emptyMessage="No calls match the current table filters."
          itemLabel="calls"
          pageSizeOptions={[10, 20, 50, 100]}
          tableClassName="min-w-[1320px]"
        />
      </div>
    </TooltipProvider>
  );
}
