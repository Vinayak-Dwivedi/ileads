import { EmptyState } from "@/components/ui/page-shell";
import { requireSession } from "@/lib/auth";
import {
  getAgentScoreboard,
  getDailyQualityScore,
  getDashboardKpis,
  getFilterOptions,
  getSentimentBreakdown,
  type DashboardFilters,
} from "@/features/dashboard/api/dashboard";
import { formatMmSs, formatPercent } from "@/lib/utils";
import { DashboardFilterBar } from "@/features/dashboard/components/filter-bar";
import { SentimentGraph } from "@/features/dashboard/components/sentiment-graph";
import { DailyQualityGraph } from "@/features/dashboard/components/daily-quality-graph";

export const dynamic = "force-dynamic";

function parseFilters(sp: Record<string, string | string[] | undefined>): DashboardFilters {
  const get = (k: string) => {
    const v = sp[k];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  const from = get("from") ? new Date(get("from")!) : undefined;
  const to = get("to") ? new Date(get("to")!) : undefined;
  return {
    campaignId: get("campaignId"),
    teamId: get("teamId"),
    agentId: get("agentId"),
    from: from && !Number.isNaN(from.valueOf()) ? from : undefined,
    to: to && !Number.isNaN(to.valueOf()) ? to : undefined,
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const filters = parseFilters(sp);

  const [kpis, sentiment, scoreboard, filterOptions, dailyQuality] = await Promise.all([
    getDashboardKpis(session.clientId, filters),
    getSentimentBreakdown(session.clientId, filters),
    getAgentScoreboard(session.clientId, filters),
    getFilterOptions(session.clientId),
    getDailyQualityScore(session.clientId, filters, 14),
  ]);


  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 p-4 md:gap-5 md:p-6">
          <DashboardFilterBar options={filterOptions} initial={filters} />

          <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <DashboardStat label="Total Calls" value={kpis.totalCalls.toLocaleString()} />
            <DashboardStat label="AI Audited" value={kpis.aiAudited.toLocaleString()} />
            <DashboardStat label="Manual Reviews" value={kpis.manualReviewed.toLocaleString()} />
            <DashboardStat
              label="First Response Time"
              value={kpis.firstResponseSeconds != null ? formatMmSs(kpis.firstResponseSeconds) : "NA"}
            />
            <DashboardStat
              label="AHT"
              value={kpis.averageHandleSeconds != null ? formatMmSs(kpis.averageHandleSeconds) : "NA"}
            />
          </section>

          <section className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
            <SentimentGraph sentiment={sentiment} />
            <DailyQualityGraph data={dailyQuality} className="md:col-span-2" />
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
            <div className="mb-3">
              <h3 className="text-base font-semibold text-slate-900">Agent Scoreboard</h3>
               </div>
            {scoreboard.length === 0 ? (
              <EmptyState title="No agents yet" description="Upload and audit calls to populate the scoreboard." />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Rank</th>
                      <th className="px-3 py-2 text-left">Agent</th>
                      <th className="px-3 py-2 text-center">Agent ID</th>
                      <th className="px-3 py-2 text-center">Campaign</th>
                      <th className="px-3 py-2 text-center">QA Score</th>
                      <th className="px-3 py-2 text-center">Calls</th>
                      <th className="px-3 py-2 text-center">AHT</th>
                      <th className="px-3 py-2 text-center">Compliance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {scoreboard.map((row) => (
                      <tr key={row.agentId}>
                        <td className="px-3 py-2">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 font-semibold text-blue-700">
                            {row.rank}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-700">{row.agentName}</td>
                        <td className="px-3 py-2 text-center text-slate-500">{row.employeeCode ?? "—"}</td>
                        <td className="px-3 py-2 text-center text-slate-500">{row.campaignName ?? "—"}</td>
                        <td className="px-3 py-2 text-center">{formatPercent(row.qaScorePercent, 1)}</td>
                        <td className="px-3 py-2 text-center">{row.callCount}</td>
                        <td className="px-3 py-2 text-center">{formatMmSs(row.ahtSeconds)}</td>
                        <td className="px-3 py-2 text-center">{formatPercent(row.compliancePercent, 0)}</td>
                      </tr>
                    ))}
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

function DashboardStat({ label, value }: { label: string; value: string }) {
  return (
    <article className="min-h-28 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      <div className="mt-2 text-3xl font-semibold leading-none text-slate-900 md:text-[34px]">{value}</div>
      
    </article>
  );
}
