import Link from "next/link";
import { Settings, FileText, Users } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
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
      {/* <Topbar title="Parameters" crumb="Clients" /> */}
      <PageShell className="html-page-bg px-5.5 py-4.5">
        <section className="html-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#e6ebf2] bg-[#fcfdff] px-4 py-3.5">
            <div>
              <h3 className="inline-flex items-center gap-2 text-base font-bold text-[#1f2937]">
                <Users className="h-4 w-4" /> Clients
              </h3>
              <p className="text-xs text-slate-500">
                Pick a client to manage its audit parameters and prompt.
              </p>
            </div>
            <div className="rounded-full border border-[#e1e7f0] bg-[#f3f6fb] px-3 py-1 text-[13px] font-semibold text-[#1f2937]">
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
                <thead className="bg-[#fcfdff] text-[#263244]">
                  <tr>
                    <th className="border-b border-[#e6ebf2] px-3 py-2.5 text-left font-semibold">Client</th>
                    <th className="border-b border-[#e6ebf2] px-3 py-2.5 text-left font-semibold">Code</th>
                    <th className="border-b border-[#e6ebf2] px-3 py-2.5 text-center font-semibold">Active</th>
                    <th className="border-b border-[#e6ebf2] px-3 py-2.5 text-center font-semibold">Active parameters</th>
                    <th className="border-b border-[#e6ebf2] px-3 py-2.5 text-center font-semibold">Total score</th>
                    <th className="border-b border-[#e6ebf2] px-3 py-2.5 text-center font-semibold">Audit prompt</th>
                    <th className="border-b border-[#e6ebf2] px-3 py-2.5 text-left font-semibold">Last updated</th>
                    <th className="border-b border-[#e6ebf2] px-3 py-2.5 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-[#edf1f6] hover:bg-[#fafcff]">
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/parameters/${r.id}`}
                          className="font-semibold text-[#2563eb] hover:underline"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 font-mono text-xs">{r.slug}</td>
                      <td className="px-3 py-2.5 text-center">
                        <Pill tone={r.isActive ? "green" : "slate"}>
                          {r.isActive ? "Active" : "Inactive"}
                        </Pill>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="font-semibold text-slate-800">{r.activeCount}</span>
                        {r.inactiveCount > 0 ? (
                          <span className="ml-1 text-xs text-slate-400">(+{r.inactiveCount} inactive)</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono text-slate-700">{r.totalScore}</td>
                      <td className="px-3 py-2.5 text-center">
                        {r.hasCustomPrompt ? (
                          <Pill tone="blue">Custom · v{r.promptVersion}</Pill>
                        ) : (
                          <Pill tone="slate">Generated</Pill>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-500 text-xs">
                        {formatShortDate(r.lastUpdated)}
                      </td>
                      <td className="px-3 py-2.5">
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
