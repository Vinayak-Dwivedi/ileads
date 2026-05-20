"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Badge } from "@/components/ui/badge";
import type { ScoreboardRow } from "@/features/dashboard/api/dashboard";
import { cn, formatMmSs, formatPercent } from "@/lib/utils";

export const agentScoreboardColumnLabels: Record<string, string> = {
  rank: "Rank",
  agentName: "Agent",
  employeeCode: "Agent ID",
  campaignName: "Campaign",
  qaScorePercent: "QA Score",
  callCount: "Calls",
  ahtSeconds: "AHT",
  compliancePercent: "Compliance",
};

export const agentScoreboardColumns: ColumnDef<ScoreboardRow>[] = [
  {
    accessorKey: "rank",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Rank" />
    ),
    cell: ({ row }) => (
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
        {row.original.rank}
      </span>
    ),
    enableHiding: false,
  },
  {
    accessorKey: "agentName",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Agent" />
    ),
    cell: ({ row }) => (
      <div className="min-w-36">
        <div className="font-semibold text-slate-900">{row.original.agentName}</div>
        {/* <div className="text-xs text-muted-foreground">
          {row.original.employeeCode ?? "No agent ID"}
        </div> */}
      </div>
    ),
    enableHiding: false,
  },
  {
    accessorKey: "employeeCode",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Agent ID" />
    ),
    cell: ({ row }) => (
      <span className="font-mono text-xs font-medium text-slate-600">
        {row.original.employeeCode ?? "-"}
      </span>
    ),
  },
  {
    accessorKey: "campaignName",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Campaign" />
    ),
    cell: ({ row }) => (
      <span className="text-slate-600">{row.original.campaignName ?? "-"}</span>
    ),
  },
  {
    accessorKey: "qaScorePercent",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="QA Score" className="justify-end" />
    ),
    cell: ({ row }) => (
      <div className="text-right">
        <ScoreBadge value={row.original.qaScorePercent} digits={1} />
      </div>
    ),
    sortingFn: "basic",
  },
  {
    accessorKey: "callCount",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Calls" className="justify-end" />
    ),
    cell: ({ row }) => (
      <div className="text-right font-mono text-sm text-slate-700">
        {row.original.callCount.toLocaleString()}
      </div>
    ),
  },
  {
    accessorKey: "ahtSeconds",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="AHT" className="justify-end" />
    ),
    cell: ({ row }) => (
      <div className="text-right font-mono text-sm text-slate-700">
        {formatMmSs(row.original.ahtSeconds)}
      </div>
    ),
    sortingFn: "basic",
  },
  {
    accessorKey: "compliancePercent",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Compliance" className="justify-end" />
    ),
    cell: ({ row }) => (
      <div className="text-right">
        <ScoreBadge value={row.original.compliancePercent} />
      </div>
    ),
    sortingFn: "basic",
  },
];

function ScoreBadge({
  value,
  digits = 0,
}: {
  value: number | null | undefined;
  digits?: number;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "min-w-16 justify-center border-slate-200 bg-slate-50 text-slate-600",
        value != null &&
          value >= 90 &&
          "border-emerald-200 bg-emerald-50 text-emerald-700",
        value != null &&
          value < 90 &&
          value >= 75 &&
          "border-amber-200 bg-amber-50 text-amber-700",
        value != null && value < 75 && "border-red-200 bg-red-50 text-red-700",
      )}
    >
      {formatPercent(value, digits)}
    </Badge>
  );
}
