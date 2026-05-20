import { requireSession } from "@/lib/auth";
import {
  getAgentScoreboard,
  getDailyQualityScore,
  getDashboardKpis,
  getFilterOptions,
  getSentimentBreakdown,
  type DashboardFilters,
} from "@/features/dashboard/api/dashboard";
import { DashboardFilterBar } from "@/features/dashboard/components/filter-bar";
import { SentimentGraph } from "@/features/dashboard/components/sentiment-graph";
import { DailyQualityGraph } from "@/features/dashboard/components/daily-quality-graph";
import { AgentScoreboardTable } from "@/features/dashboard/components/agent-scoreboard-table";

export const dynamic = "force-dynamic";

function parseFilters(
  sp: Record<string, string | string[] | undefined>,
): DashboardFilters {
  const get = (key: string) => {
    const value = sp[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
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

  const [kpis, sentiment, scoreboard, filterOptions, dailyQuality] =
    await Promise.all([
      getDashboardKpis(session.clientId, filters),
      getSentimentBreakdown(session.clientId, filters),
      getAgentScoreboard(session.clientId, filters, 25),
      getFilterOptions(session.clientId),
      getDailyQualityScore(session.clientId, filters, 14),
    ]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 p-4 md:gap-5 md:p-6">
          <DashboardFilterBar options={filterOptions} initial={filters} />

          <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
            <DashboardStat label="Total Calls" value={kpis.totalCalls.toLocaleString()} />
            <DashboardStat label="AI Audited" value={kpis.aiAudited.toLocaleString()} />
            <DashboardStat
              label="Manual Reviews"
              value={kpis.manualReviewed.toLocaleString()}
            />
            <DashboardStat
              label="AI Audit Score"
              value={formatScorePercent(kpis.aiAuditScorePercent)}
            />
            <DashboardStat
              label="Manual Audit Score"
              value={formatScorePercent(kpis.manualAuditScorePercent)}
            />
            <DashboardStat
              label="Avg Score"
              value={formatScorePercent(kpis.averageAuditScorePercent)}
            />
          </section>

          <section className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4">
            <SentimentGraph sentiment={sentiment} />
            <DailyQualityGraph data={dailyQuality} className="md:col-span-2" />
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
            <div className="mb-3">
              <h3 className="text-base font-semibold text-slate-900">
                Agent Scoreboard
              </h3>
            </div>
            <AgentScoreboardTable data={scoreboard} />
          </section>
        </div>
      </div>
    </div>
  );
}

function formatScorePercent(value: number | null): string {
  return value == null || Number.isNaN(value) ? "NA" : `${Math.round(value)}%`;
}

function DashboardStat({ label, value }: { label: string; value: string }) {
  return (
    <article className="min-h-28 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <div className="mt-2 text-3xl font-semibold leading-none text-slate-900 md:text-[34px]">
        {value}
      </div>
    </article>
  );
}
