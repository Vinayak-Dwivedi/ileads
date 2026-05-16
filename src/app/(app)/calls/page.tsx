import Link from "next/link";
import { Topbar } from "@/components/layout/topbar";
import { PageShell, EmptyState } from "@/components/ui/page-shell";
import { Pill } from "@/components/ui/pill";
import { ScorePill, AuditStatusPill } from "@/components/ui/score-pill";
import { SentimentBadge } from "@/components/ui/sentiment-badge";
import { requireSession } from "@/lib/auth";
import { getCallUploadOptions, listCalls, type CallListFilters } from "@/lib/data/calls";
import { getFilterOptions } from "@/lib/data/dashboard";
import { formatDuration, formatShortDate, formatTime } from "@/lib/utils";
import { Download, FileText, Play, Search } from "lucide-react";
import { CallsFilterBar } from "./filter-bar";
import { UploadCallsDialog } from "./upload-calls-dialog";

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
    <>
      <Topbar
        title="Calls"
        crumb="Library"
        right={
          <div className="flex flex-wrap items-center gap-[14px]">
            <form action="/calls" className="hidden h-10 w-[360px] items-center gap-2 rounded-lg border border-[#d6dcea] bg-white px-3 text-sm text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] xl:flex">
              <Search className="h-4 w-4 text-slate-500" />
              <input
                name="q"
                defaultValue={filters.search ?? ""}
                className="w-full border-0 bg-transparent outline-none placeholder:text-slate-500"
                placeholder="Search by Call ID, Agent Name, Customer Number..."
              />
            </form>
            <button
              type="button"
              className="html-btn hidden sm:inline-flex"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
            <UploadCallsDialog options={uploadOptions} />
          </div>
        }
      />
      <PageShell className="html-page-bg p-[10px] md:px-[22px] md:py-[18px]">
        <CallsFilterBar options={filterOptions} initial={filters} className="mb-5" />

        <section className="html-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#e6ebf2] bg-[#fcfdff] px-4 py-3">
            <h3 className="text-sm font-semibold text-[#263244]">
              {calls.length.toLocaleString()} call{calls.length === 1 ? "" : "s"}
            </h3>
            <span className="text-xs text-slate-500">Database-backed results</span>
          </div>

          {calls.length === 0 ? (
            <EmptyState
              className="m-4"
              title="No calls match"
              description="Try clearing filters or upload audio files to create pending calls."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1480px] border-collapse text-sm">
                <thead>
                  <tr>
                    <Th>Call ID</Th>
                    <Th>Date &amp; Time <span className="ml-1 text-xs text-slate-500">↓</span></Th>
                    <Th>Client</Th>
                    <Th>Campaign</Th>
                    <Th>Team</Th>
                    <Th>Agent Name</Th>
                    <Th>Customer Number</Th>
                    <Th>Duration</Th>
                    <Th>AI Score</Th>
                    <Th>Manual Score</Th>
                    <Th>Final Score</Th>
                    <Th>Sentiment</Th>
                    <Th>Audit Status</Th>
                    <Th>Manual Disposition</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((c) => {
                    const callIdText = c.externalCallId ?? `CALL-${c.id.slice(-6).toUpperCase()}`;
                    const auditStatus =
                      c.aiScore != null ? "COMPLETED" : c.manualReviews[0]?.status ?? "PENDING";
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
                        <Td>{c.client.name}</Td>
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
                        <Td>
                          <AuditStatusPill status={auditStatus} />
                        </Td>
                        <Td>
                          {c.manualDisposition ? (
                            <Pill tone={manualDispositionTone(c.manualDisposition)}>
                              {c.manualDisposition}
                            </Pill>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-grid h-7 w-7 place-items-center rounded-full border ${
                                c.audioPath || c.recordingUrl
                                  ? "border-blue-100 bg-blue-50 text-blue-600"
                                  : "border-slate-200 bg-slate-50 text-slate-300"
                              }`}
                              title={c.audioPath || c.recordingUrl ? "Audio available" : "No audio"}
                            >
                              <Play className="h-3.5 w-3.5 fill-current" />
                            </span>
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

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            <div>Showing {calls.length === 0 ? 0 : 1} to {calls.length} of {calls.length} calls</div>
            <div className="flex items-center gap-2" aria-label="Pagination">
              <span className="grid h-9 min-w-9 place-items-center rounded-lg border border-[#d8dfeb] bg-white px-3">⟪</span>
              <span className="grid h-9 min-w-9 place-items-center rounded-lg border border-[#d8dfeb] bg-white px-3">‹</span>
              <span className="grid h-9 min-w-9 place-items-center rounded-lg border border-transparent bg-[linear-gradient(180deg,#366cf0_0%,#2d5fdd_100%)] px-3 text-white shadow-[0_10px_20px_rgba(45,98,223,0.2)]">1</span>
              <span className="grid h-9 min-w-9 place-items-center rounded-lg border border-[#d8dfeb] bg-white px-3">›</span>
              <span className="grid h-9 min-w-9 place-items-center rounded-lg border border-[#d8dfeb] bg-white px-3">⟫</span>
            </div>
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <span className="rounded-md border border-slate-200 bg-white px-2 py-1">200</span>
            </div>
          </div>
        </section>
      </PageShell>
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="whitespace-nowrap border-b border-[#e6ebf2] bg-[#fcfdff] px-2.5 py-3 text-left text-sm font-semibold text-[#263244]">
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
    <td className={`whitespace-nowrap border-b border-[#edf1f6] px-2.5 py-3 align-middle text-[#283142] ${className ?? ""}`}>
      {children}
    </td>
  );
}
