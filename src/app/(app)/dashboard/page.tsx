import { Topbar } from "@/components/layout/topbar";
import { EmptyState, PageShell } from "@/components/ui/page-shell";
import { requireSession } from "@/lib/auth";
import {
  getAgentScoreboard,
  getDashboardInsights,
  getDashboardKpis,
  getFilterOptions,
  getSentimentBreakdown,
  type DashboardFilters,
} from "@/lib/data/dashboard";
import { formatMmSs, formatPercent } from "@/lib/utils";
import { AlertTriangle, Lightbulb, Mail, Plus, ShieldAlert, Sparkles, Sun } from "lucide-react";
import { DashboardFilterBar } from "./filter-bar";

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
    <>
      <Topbar title="Dashboard" />
      <PageShell className="bg-[#f5f6f8] p-5">
        <DashboardFilterBar options={filterOptions} initial={filters} className="mb-5" />

        <section className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
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

        <section className="grid grid-cols-1 gap-4 2xl:grid-cols-[2.7fr_1fr]">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <h3 className="mb-3 text-lg font-semibold text-slate-800">Customer Sentiment Distribution</h3>
              {sentiment.total === 0 ? (
                <EmptyState title="No sentiment data" description="No calls have sentiment values in this filter." />
              ) : (
                <div className="rounded-xl border border-slate-100 p-4">
                  <Bar label="Positive" pct={pct(sentiment.positive, sentiment.total)} color="bg-emerald-500" />
                  <Bar label="Neutral" pct={pct(sentiment.neutral, sentiment.total)} color="bg-amber-500" />
                  <Bar label="Negative" pct={pct(sentiment.negative, sentiment.total)} color="bg-red-500" />
                </div>
              )}
            </article>

            <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <h3 className="mb-3 text-lg font-semibold text-slate-800">Average Quality Score</h3>
              {kpis.averageQualityPercent == null ? (
                <EmptyState
                  title="Trend data will appear after more calls are processed."
                  description="No quality score is available for the selected filters."
                />
              ) : (
                <div className="flex min-h-[220px] flex-col justify-center rounded-xl border border-slate-100 bg-white p-4">
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

            <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm xl:col-span-2">
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
            </article>
          </div>

          <article className="h-fit rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <h3 className="mb-3 text-lg font-semibold text-slate-800">Recommendations</h3>
            <div className="space-y-3 rounded-xl border border-slate-100 bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-600 text-white">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-slate-800">AI Insights</div>
                  <div className="text-xs text-slate-500">Stored analysis from audited calls</div>
                </div>
              </div>
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
                        <div className="text-xs font-semibold text-slate-500">{insight.insightType.replace("_", " ")}</div>
                        <div className="text-sm text-slate-700">{insight.title}</div>
                        <div className="mt-1 text-xs text-slate-500">{insight.body}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </article>
        </section>
      </PageShell>
    </>
  );
}

function DashboardStat({ label, value }: { label: string; value: string }) {
  return (
    <article className="min-h-[120px] rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="block text-lg text-slate-500">{label}</label>
      <div className="mt-2 text-[34px] leading-none text-slate-900 md:text-[38px]">{value}</div>
      
    </article>
  );
}

function Bar({ label, pct, color }: { label: string; pct: number; color: string }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-2 flex justify-between">
        <span className="text-sm text-slate-600">{label}</span>
        <strong className="text-sm text-slate-800">{pct}%</strong>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
