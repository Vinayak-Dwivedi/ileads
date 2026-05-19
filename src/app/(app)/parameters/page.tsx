import Link from "next/link";
import { Settings, FileText, Users } from "lucide-react";
import { PageShell, EmptyState } from "@/components/ui/page-shell";
import { Pill } from "@/components/ui/pill";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatShortDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ParametersClientsPage() {
  await requireSession();

  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      updatedAt: true,
      parameters: {
        select: { id: true, maxScore: true, isActive: true, updatedAt: true },
      },
      auditPrompts: {
        where: { isActive: true },
        select: { id: true, versionNo: true, updatedAt: true },
        take: 1,
      },
    },
  });

  const rows = clients.map((c) => {
    const activeParams = c.parameters.filter((p) => p.isActive);
    const totalScore = activeParams.reduce((s, p) => s + p.maxScore, 0);
    const lastParamUpdate = c.parameters.reduce<Date | null>((latest, p) => {
      if (!latest || p.updatedAt > latest) return p.updatedAt;
      return latest;
    }, null);
    const lastPromptUpdate = c.auditPrompts[0]?.updatedAt ?? null;
    const lastUpdated = [c.updatedAt, lastParamUpdate, lastPromptUpdate]
      .filter((d): d is Date => d != null)
      .reduce<Date | null>((latest, d) => (!latest || d > latest ? d : latest), null);
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      isActive: c.isActive,
      activeCount: activeParams.length,
      inactiveCount: c.parameters.length - activeParams.length,
      totalScore,
      hasCustomPrompt: c.auditPrompts.length > 0,
      promptVersion: c.auditPrompts[0]?.versionNo ?? null,
      lastUpdated,
    };
  });

  return (
    <>
      <PageShell className="html-page-bg mx-auto w-full max-w-[1440px] px-4 py-4 md:px-6 md:py-6">
        <section className="html-card overflow-hidden">
          <div className="html-section-header flex items-center justify-between">
            <div>
              <h3 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
                <Users className="h-4 w-4" /> Clients
              </h3>
             
            </div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[13px] font-semibold text-slate-700">
              {rows.length} client{rows.length === 1 ? "" : "s"}
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              className="m-4"
              title="No clients"
              description="Seed a client first via prisma seed."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="html-table-head">Client</th>
                    <th className="html-table-head">Code</th>
                    <th className="html-table-head text-center">Active</th>
                    <th className="html-table-head text-center">Active parameters</th>
                    <th className="html-table-head text-center">Total score</th>
                    <th className="html-table-head text-center">Audit prompt</th>
                    <th className="html-table-head">Last updated</th>
                    <th className="html-table-head text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="html-table-cell">
                        <Link
                          href={`/parameters/${r.id}`}
                          className="font-semibold text-[#2563eb] hover:underline"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="html-table-cell font-mono text-xs text-slate-600">{r.slug}</td>
                      <td className="html-table-cell text-center">
                        <Pill tone={r.isActive ? "green" : "slate"}>
                          {r.isActive ? "Active" : "Inactive"}
                        </Pill>
                      </td>
                      <td className="html-table-cell text-center">
                        <span className="font-semibold text-slate-800">{r.activeCount}</span>
                        {r.inactiveCount > 0 ? (
                          <span className="ml-1 text-xs text-slate-400">(+{r.inactiveCount} inactive)</span>
                        ) : null}
                      </td>
                      <td className="html-table-cell text-center font-mono text-slate-700">{r.totalScore}</td>
                      <td className="html-table-cell text-center">
                        {r.hasCustomPrompt ? (
                          <Pill tone="blue">Custom · v{r.promptVersion}</Pill>
                        ) : (
                          <Pill tone="slate">Generated</Pill>
                        )}
                      </td>
                      <td className="html-table-cell text-xs text-slate-500">
                        {formatShortDate(r.lastUpdated)}
                      </td>
                      <td className="html-table-cell">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/parameters/${r.id}`}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Settings className="h-3.5 w-3.5" /> Parameters
                          </Link>
                          <Link
                            href={`/parameters/${r.id}#prompt`}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <FileText className="h-3.5 w-3.5" /> Prompt
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </PageShell>
    </>
  );
}
