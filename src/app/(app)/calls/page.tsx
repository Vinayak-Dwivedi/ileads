import Link from "next/link";
import { EmptyState } from "@/components/ui/page-shell";
import { Pill } from "@/components/ui/pill";
import { ScorePill, AuditStatusPill } from "@/components/ui/score-pill";
import { SentimentBadge } from "@/components/ui/sentiment-badge";
import { requireSession } from "@/lib/auth";
import { getCallUploadOptions, listCalls, type CallListFilters } from "@/lib/data/calls";
import { getFilterOptions } from "@/features/dashboard/api/dashboard";
import { formatDuration, formatShortDate, formatTime } from "@/lib/utils";
import { FileText, Play } from "lucide-react";
import { CallsFilterBar } from "@/features/calls/components/filter-bar";

export const dynamic = "force-dynamic";

function parseFilters(sp: Record<string, string | string[] | undefined>): CallListFilters {
  const get = (k: string) => {
    const v = sp[k];
    return typeof v === "string" && v.length > 0 ? v : undefined;
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
    manualDisposition: get("disposition"),
    from: from && !Number.isNaN(from.valueOf()) ? from : undefined,
    to: to && !Number.isNaN(to.valueOf()) ? to : undefined,
  };
}

function manualDispositionTone(d: string | null): "green" | "red" | "yellow" | "slate" {
  if (!d) return "slate";
  if (d === "Good") return "green";
  if (d === "Bad") return "red";
  if (d === "Moderate") return "yellow";
  return "slate";
}

function pipelineStatus(call: {
  processingStatus: string | null;
  transcript: { id: string } | null;
  aiScore: number | null;
}): { label: string; tone: "green" | "red" | "yellow" | "blue" | "slate" } {
  if (call.processingStatus && call.processingStatus !== "idle") {
    if (call.processingStatus === "failed") return { label: "Failed", tone: "red" };
    return { label: "Processing", tone: "blue" };
  }
  if (call.aiScore != null) return { label: "Audited", tone: "green" };
  if (call.transcript) return { label: "Transcribed", tone: "yellow" };
  return { label: "Uploaded", tone: "slate" };
}

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const filters = parseFilters(sp);

  const [calls, filterOptions, uploadOptions] = await Promise.all([
    listCalls(session.clientId, filters, 200),
    getFilterOptions(session.clientId),
    getCallUploadOptions(session.clientId),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-4 md:gap-5 md:p-6">

          <CallsFilterBar options={filterOptions} initial={filters} uploadOptions={uploadOptions} />

          <section className="html-card overflow-hidden">
            <div className="html-section-header flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {calls.length.toLocaleString()} call{calls.length === 1 ? "" : "s"}
                </h3>
                <p className="text-xs text-slate-500">Database-backed results</p>
              </div>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-500">
                Showing up to 200
              </span>
            </div>

            {calls.length === 0 ? (
              <EmptyState
                className="m-4"
                title="No calls yet"
                description="Upload a call to begin."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1320px] border-collapse text-sm">
                  <thead>
                    <tr>
                      <Th>Call ID</Th>
                      <Th>Date &amp; Time</Th>
                      {/* <Th>Client</Th> */}
                      <Th>Campaign</Th>
                      <Th>Team</Th>
                      <Th>Agent</Th>
                      <Th>Customer</Th>
                      <Th>Duration</Th>
                      <Th>AI Score</Th>
                      <Th>Manual</Th>
                      <Th>Final</Th>
                      <Th>Sentiment</Th>
                      {/* <Th>Pipeline</Th> */}
                      <Th>Audit</Th>
                      {/* <Th>Disposition</Th> */}
                      <Th>Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {calls.map((c) => {
                      const callIdText = c.externalCallId ?? `CALL-${c.id.slice(-6).toUpperCase()}`;
                      const auditStatus =
                        c.aiScore != null ? "COMPLETED" : c.manualReviews[0]?.status ?? "PENDING";
                      const flow = pipelineStatus(c);
                      return (
                        <tr key={c.id} className="border-b border-[#edf1f6] hover:bg-[#fafcff]">
                          <Td>
                            <Link
                              href={`/calls/${c.id}`}
                              className="font-semibold text-[#2563eb] hover:underline"
                            >
                              {callIdText}
                            </Link>
                          </Td>
                          <Td>
                            <div className="leading-tight">
                              <div className="text-slate-700">{formatShortDate(c.callStartedAt)}</div>
                              <div className="text-xs text-slate-500">{formatTime(c.callStartedAt)}</div>
                            </div>
                          </Td>
                          {/* <Td>{c.client.name}</Td> */}
                          <Td>{c.campaign?.name ?? "—"}</Td>
                          <Td>{c.team?.name ?? "—"}</Td>
                          <Td>{c.agent?.name ?? "—"}</Td>
                          <Td className="text-slate-600">
                            {c.customerName ? (
                              <div className="leading-tight">
                                <div>{c.customerName}</div>
                                <div className="text-xs text-slate-500">{c.callerNumber ?? c.calleeNumber ?? ""}</div>
                              </div>
                            ) : (
                              c.callerNumber ?? c.calleeNumber ?? "—"
                            )}
                          </Td>
                          <Td>{formatDuration(c.durationSeconds)}</Td>
                          <Td>
                            <ScorePill value={c.aiScore} />
                          </Td>
                          <Td>
                            <ScorePill value={c.manualScore} />
                          </Td>
                          <Td>
                            <ScorePill value={c.finalScore} />
                          </Td>
                          <Td>
                            <SentimentBadge value={c.sentiment} />
                          </Td>
                          {/* <Td>
                            <Pill tone={flow.tone}>{flow.label}</Pill>
                          </Td> */}
                          <Td>
                            <AuditStatusPill status={auditStatus} />
                          </Td>
                          {/* <Td>
                            {c.manualDisposition ? (
                              <Pill tone={manualDispositionTone(c.manualDisposition)}>
                                {c.manualDisposition}
                              </Pill>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </Td> */}
                          <Td>
                            <div className="flex items-center gap-2">
                              {/* <span
                                className={`inline-grid h-7 w-7 place-items-center rounded-full border ${c.audioPath || c.recordingUrl
                                  ? "border-blue-100 bg-blue-50 text-blue-600"
                                  : "border-slate-200 bg-slate-50 text-slate-300"
                                  }`}
                                title={c.audioPath || c.recordingUrl ? "Audio available" : "No audio"}
                              >
                                <Play className="h-3.5 w-3.5 fill-current" />
                              </span> */}
                              <Link
                                href={`/calls/${c.id}`}
                                className="inline-grid h-7 w-7 place-items-center rounded-full border border-[#cfd7e5] bg-white text-slate-700 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:bg-slate-50"
                                title="View details"
                              >
                                <FileText className="h-4 w-4" />
                                <span className="sr-only">View details</span>
                              </Link>
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="html-table-head whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={`html-table-cell whitespace-nowrap ${className ?? ""}`}>
      {children}
    </td>
  );
}
