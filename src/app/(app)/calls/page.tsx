import { requireSession } from "@/lib/auth";
import {
  getCallUploadOptions,
  listCalls,
  type CallListFilters,
  type CallListItem,
} from "@/features/calls/api/calls";
import { getFilterOptions } from "@/features/dashboard/api/dashboard";
import { CallsFilterBar } from "@/features/calls/components/filter-bar";
import { CallsTable } from "@/features/calls/components/calls-table";
import type { CallsTableRow } from "@/features/calls/components/calls-table-columns";
import { formatShortDate, formatTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

function parseFilters(sp: Record<string, string | string[] | undefined>): CallListFilters {
  const get = (key: string) => {
    const value = sp[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };
  const from = get("from") ? new Date(get("from")!) : undefined;
  const to = get("to") ? new Date(get("to")!) : undefined;

  return {
    search: get("q"),
    campaignId: get("campaignId"),
    teamId: get("teamId"),
    agentId: get("agentId"),
    sentiment: get("sentiment"),
    auditStatus: get("auditStatus"),
    // manualDisposition: get("disposition"),
    from: from && !Number.isNaN(from.valueOf()) ? from : undefined,
    to: to && !Number.isNaN(to.valueOf()) ? to : undefined,
  };
}

function getAuditStatus(call: CallListItem) {
  if (call.processingStatus === "uploaded") return "UPLOADED";
  if (call.processingStatus === "transcribing") return "TRANSCRIBING";
  if (call.processingStatus === "auditing") return "AUDITING";
  if (call.processingStatus === "failed") return "FAILED";
  
  return call.aiScore != null ? "COMPLETED" : (call.manualReviews[0]?.status ?? "PENDING");
}

function getCallId(call: CallListItem) {
  return call.externalCallId ?? `CALL-${call.id.slice(-6).toUpperCase()}`;
}

function toCallsTableRow(call: CallListItem): CallsTableRow {
  const callId = getCallId(call);
  const customerNumber = call.callerNumber ?? call.calleeNumber;
  const auditStatus = getAuditStatus(call);
  const audioHref = call.audioPath
    ? `/api/calls/${call.id}/audio`
    : (call.recordingUrl ?? null);

  return {
    id: call.id,
    callId,
    startedAtDate: formatShortDate(call.callStartedAt),
    startedAtTime: formatTime(call.callStartedAt),
    startedAtTimestamp: call.callStartedAt?.getTime() ?? 0,
    campaignName: call.campaign?.name ?? null,
    // teamName: call.team?.name ?? null,
    agentName: call.agent?.name ?? null,
    // customerName: call.customerName,
    // customerNumber,
    durationSeconds: call.durationSeconds,
    aiScore: call.aiScore,
    manualScore: call.manualScore,
    finalScore: call.finalScore,
    sentiment: call.sentiment,
    auditStatus,
    audioHref,
    searchText: [
      callId,
      call.id,
      call.campaign?.name,
      // call.team?.name,
      call.agent?.name,
      // call.customerName,
      customerNumber,
      call.sentiment,
      auditStatus,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const maxFileMb = Number(process.env.MAX_AUDIO_UPLOAD_MB ?? "100") || 100;

  const [calls, filterOptions, uploadOptions] = await Promise.all([
    listCalls(session.clientId, filters, 200),
    getFilterOptions(session.clientId),
    getCallUploadOptions(session.clientId),
  ]);
  const tableRows = calls.map(toCallsTableRow);

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-4 md:gap-5 md:p-6">
          <CallsFilterBar
            options={filterOptions}
            initial={filters}
            uploadOptions={uploadOptions}
            maxFileMb={maxFileMb}
          />

          <section className="html-card overflow-hidden">
            {/* <div className="html-section-header flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {calls.length.toLocaleString()} call{calls.length === 1 ? "" : "s"}
                </h3>
                <p className="text-xs text-slate-500">Database-backed results</p>
              </div>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500">
                Showing up to 200
              </span>
            </div> */}

            <CallsTable data={tableRows} />
          </section>
        </div>
      </div>
    </div>
  );
}
