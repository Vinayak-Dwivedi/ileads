"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { FileTextIcon, PlayIcon } from "lucide-react";

import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { AuditStatusPill, ScorePill } from "@/components/ui/score-pill";
import { SentimentBadge } from "@/components/ui/sentiment-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { withBasePath } from "@/lib/base-path";
import { formatDuration } from "@/lib/utils";

export interface CallsTableRow {
  id: string;
  callId: string;
  startedAtDate: string;
  startedAtTime: string;
  startedAtTimestamp: number;
  campaignName: string | null;
  // teamName: string | null;
  agentName: string | null;
  // customerName: string | null;
  // customerNumber: string | null;
  durationSeconds: number | null;
  aiScore: number | null;
  manualScore: number | null;
  finalScore: number | null;
  sentiment: string | null;
  auditStatus: string;
  audioHref: string | null;
  searchText: string;
}

export const callsColumnLabels: Record<string, string> = {
  callId: "Call ID",
  startedAtTimestamp: "Date & Time",
  campaignName: "Campaign",
  // teamName: "Team",
  agentName: "Agent",
  // customerName: "Customer",
  durationSeconds: "Duration",
  aiScore: "AI Score",
  manualScore: "Manual",
  finalScore: "Final",
  sentiment: "Sentiment",
  auditStatus: "Audit",
};

export const callsTableColumns: ColumnDef<CallsTableRow>[] = [
  {
    accessorKey: "searchText",
    header: () => null,
    cell: () => null,
    enableHiding: false,
    enableSorting: false,
  },
  {
    accessorKey: "callId",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Call ID" />
    ),
    cell: ({ row }) => <CallIdCell call={row.original} />,
    enableHiding: false,
  },
  {
    accessorKey: "startedAtTimestamp",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Date & Time" />
    ),
    cell: ({ row }) => (
      <div className="min-w-24 leading-tight">
        <div className="text-slate-700">{row.original.startedAtDate}</div>
        <div className="text-xs text-muted-foreground">
          {row.original.startedAtTime}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "campaignName",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Campaign" />
    ),
    cell: ({ row }) => <MutedText value={row.original.campaignName} />,
  },
  // {
  //   accessorKey: "teamName",
  //   header: ({ column }) => <DataTableColumnHeader column={column} title="Team" />,
  //   cell: ({ row }) => <MutedText value={row.original.teamName} />,
  // },
  {
    accessorKey: "agentName",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Agent" />
    ),
    cell: ({ row }) => (
      <span className="font-medium text-slate-700">
        {row.original.agentName ?? "-"}
      </span>
    ),
  },
  // {
  //   accessorKey: "customerName",
  //   header: ({ column }) => (
  //     <DataTableColumnHeader column={column} title="Customer" />
  //   ),
  //   cell: ({ row }) => (
  //     <div className="leading-tight text-slate-600">
  //       <div className="max-w-44 truncate">
  //         {row.original.customerName ?? row.original.customerNumber ?? "-"}
  //       </div>
  //       {row.original.customerName && row.original.customerNumber ? (
  //         <div className="max-w-44 truncate text-xs text-muted-foreground">
  //           {row.original.customerNumber}
  //         </div>
  //       ) : null}
  //     </div>
  //   ),
  // },
  {
    accessorKey: "durationSeconds",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Duration" className="justify-end" />
    ),
    cell: ({ row }) => (
      <div className="text-right font-mono text-sm text-slate-700">
        {formatDuration(row.original.durationSeconds)}
      </div>
    ),
  },
  {
    accessorKey: "aiScore",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="AI Score" className="justify-end" />
    ),
    cell: ({ row }) => (
      <div className="text-right">
        <ScorePill value={row.original.aiScore} />
      </div>
    ),
  },
  {
    accessorKey: "manualScore",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Manual" className="justify-end" />
    ),
    cell: ({ row }) => (
      <div className="text-right">
        <ScorePill value={row.original.manualScore} />
      </div>
    ),
  },
  {
    accessorKey: "finalScore",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Final" className="justify-end" />
    ),
    cell: ({ row }) => (
      <div className="text-right">
        <ScorePill value={row.original.finalScore} />
      </div>
    ),
  },
  {
    accessorKey: "sentiment",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Sentiment" />
    ),
    cell: ({ row }) => <SentimentBadge value={row.original.sentiment} />,
  },
  {
    accessorKey: "auditStatus",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Audit" />
    ),
    cell: ({ row }) => <AuditStatusPill status={row.original.auditStatus} />,
  },
  {
    id: "actions",
    header: () => <div className="text-right">Actions</div>,
    cell: ({ row }) => <CallActions call={row.original} />,
    enableHiding: false,
    enableSorting: false,
  },
];

function CallIdCell({ call }: { call: CallsTableRow }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={`/calls/${call.id}`}
          className="block max-w-36 truncate font-mono text-xs font-semibold text-blue-600 hover:underline"
        >
          {call.callId}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        <span className="font-mono">{call.callId}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function CallActions({ call }: { call: CallsTableRow }) {
  return (
    <div className="flex justify-end">
      <ButtonGroup>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild type="button" variant="outline" size="icon-sm">
              <Link href={`/calls/${call.id}`} aria-label={`View ${call.callId}`}>
                <FileTextIcon />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            View details
          </TooltipContent>
        </Tooltip>

        {/* {call.audioHref ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild type="button" variant="outline" size="icon-sm">
                <a
                  href={
                    call.audioHref.startsWith("/")
                      ? withBasePath(call.audioHref)
                      : call.audioHref
                  }
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Play audio for ${call.callId}`}
                >
                  <PlayIcon />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              Open audio
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  disabled
                  aria-label="No audio available"
                >
                  <PlayIcon />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              No audio available
            </TooltipContent>
          </Tooltip>
        )} */}
      </ButtonGroup>
    </div>
  );
}

function MutedText({ value }: { value: string | null }) {
  return <span className="text-slate-600">{value ?? "-"}</span>;
}
