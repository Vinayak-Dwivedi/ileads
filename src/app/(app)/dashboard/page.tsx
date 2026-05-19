import { EmptyState, PageShell } from "@/components/ui/page-shell";
import { requireSession } from "@/lib/auth";
import {
  getAgentScoreboard,
  getDashboardInsights,
  getDashboardKpis,
  getFilterOptions,
  getSentimentBreakdown,
  type DashboardFilters,
} from "@/features/dashboard/api/dashboard";
import { formatMmSs, formatPercent } from "@/lib/utils";
import { AlertTriangle, Lightbulb, Mail, Plus, ShieldAlert, Sun } from "lucide-react";
import { DashboardFilterBar } from "@/features/dashboard/components/filter-bar";
import { SentimentGraph } from "@/features/dashboard/components/sentiment-graph";

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

function insightIcon(type: string) {
  const t = type.toUpperCase();
  if (t === "COMPLIANCE") return { Icon: ShieldAlert, tint: "bg-red-100 text-red-600" };
  if (t === "RISK") return { Icon: AlertTriangle, tint: "bg-orange-100 text-orange-600" };
  if (t === "OPPORTUNITY") return { Icon: Plus, tint: "bg-emerald-100 text-emerald-600" };
  if (t === "SENTIMENT") return { Icon: Mail, tint: "bg-violet-100 text-violet-600" };
  if (t === "COACHING") return { Icon: Sun, tint: "bg-blue-100 text-blue-600" };
  return { Icon: Lightbulb, tint: "bg-slate-100 text-slate-600" };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const filters = parseFilters(sp);

  const [kpis, sentiment, scoreboard, insights, filterOptions] = await Promise.all([
    getDashboardKpis(session.clientId, filters),
    getSentimentBreakdown(session.clientId, filters),
    getAgentScoreboard(session.clientId, filters),
    getDashboardInsights(session.clientId, filters),
    getFilterOptions(session.clientId),
  ]);


  const pct = (n: number, total: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 p-4 md:gap-6 md:p-6">
          {/* <Topbar title="Dashboard" /> */}
          {/* <PageShell className="bg-[#f5f6f8] p-5"> */}
          <DashboardFilterBar options={filterOptions} initial={filters} />

          <section className=" grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
            <DashboardStat label="Total Call" value={kpis.totalCalls.toLocaleString()} />
            <DashboardStat label="AI Audited" value={kpis.aiAudited.toLocaleString()} />
            <DashboardStat label="Manual Reviewed" value={kpis.manualReviewed.toLocaleString()} />
            <DashboardStat
              label="Avg Quality Score"
              value={kpis.averageQualityPercent != null ? formatPercent(kpis.averageQualityPercent, 1) : "NA"}
            />
            <DashboardStat
              label="First Response Time"
              value={kpis.firstResponseSeconds != null ? formatMmSs(kpis.firstResponseSeconds) : "NA"}
            />
            <DashboardStat
              label="AHT"
              value={kpis.averageHandleSeconds != null ? formatMmSs(kpis.averageHandleSeconds) : "NA"}
            />
          </section>

          <section className="grid grid-cols-1 md:grid-cols-3 gap-2 md:gap-4">
            <SentimentGraph sentiment={sentiment} />
            {/* <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-lg font-semibold text-slate-800">Customer Sentiment Distribution</h3>
              {sentiment.total === 0 ? (
                <EmptyState title="No sentiment data" description="No calls have sentiment values in this filter." />
              ) : (
                <div className="[&>*:not(:last-child)]:mb-2!">
                  <Bar label="Positive" pct={pct(sentiment.positive, sentiment.total)} color="bg-emerald-500" />
                  <Bar label="Neutral" pct={pct(sentiment.neutral, sentiment.total)} color="bg-amber-500" />
                  <Bar label="Negative" pct={pct(sentiment.negative, sentiment.total)} color="bg-red-500" />
                </div>
              )}
            </article> */}

            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:col-span-2">
              <h3 className=" text-lg font-semibold text-slate-800 mb-3">Average Quality Score</h3>
              {kpis.averageQualityPercent == null ? (
                <EmptyState
                  title="Trend data will appear after more calls are processed."
                  description="No quality score is available for the selected filters."
                />
              ) : (
                <div className="flex flex-col justify-center rounded-xl">
                  <div className="text-[40px] font-bold leading-none text-slate-900">
                    {formatPercent(kpis.averageQualityPercent, 1)}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Mean final score from stored calls. Falls back to AI score only when final score is missing.
                  </p>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-[#3f106b]"
                      style={{ width: `${Math.min(100, Math.max(0, kpis.averageQualityPercent))}%` }}
                    />
                  </div>
                  <p className="mt-3 text-xs text-slate-400">
                    Trend chart hidden: no real weekly comparison data is stored yet.
                  </p>
                </div>
              )}
            </article>



            {/* <article className="h-fit rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <h3 className="mb-3 text-lg font-semibold text-slate-800">Recommendations</h3>
              <div className="space-y-3 ">

                {insights.length === 0 ? (
                  <EmptyState
                    title="No insights yet"
                    description="Real AI insights appear once stored audits flag risks or opportunities."
                  />
                ) : (
                  insights.map((insight) => {
                    const { Icon, tint } = insightIcon(insight.insightType);
                    return (
                      <div key={insight.id} className="grid grid-cols-[32px_1fr] gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <div className={`grid h-8 w-8 place-items-center rounded-lg ${tint}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-muted-foreground">{insight.insightType.replace("_", " ")}</div>
                          <div className="text-sm text-slate-700">{insight.title}</div>
                          <div className="mt-1 text-xs text-slate-500">{insight.body}</div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </article> */}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm xl:col-span-2">
            <h3 className="mb-3 text-lg font-semibold text-slate-800">Agent Scoreboard</h3>
            {scoreboard.length === 0 ? (
              <EmptyState title="No agents yet" description="No calls have been attributed to agents." />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full text-[13px]">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
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
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 font-bold text-blue-600">
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
          {/* </PageShell> */}
        </div>
      </div>
    </div>
  );
}

function DashboardStat({ label, value }: { label: string; value: string }) {
  return (
    <article className="min-h-30 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="block text-slate-500">{label}</label>
      <div className="mt-2 text-[34px] leading-none text-slate-900 md:text-[38px]">{value}</div>
      {/* <div className="mt-3 text-sm text-slate-400">Current filter</div> */}
    </article>
  );
}


