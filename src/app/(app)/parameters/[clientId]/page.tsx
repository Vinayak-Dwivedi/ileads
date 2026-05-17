import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { PageShell } from "@/components/ui/page-shell";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listParameters, listParameterCategories } from "@/lib/data/parameters";
import { generateDefaultPromptForClient } from "@/services/audit/buildLiveAuditPrompt";
import { ParameterEditor } from "../editor";
import { PromptEditor } from "./prompt-editor";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ClientParametersPage({ params, searchParams }: PageProps) {
  const { clientId } = await params;
  await requireSession();

  const sp = await searchParams;
  const search = typeof sp.q === "string" ? sp.q : "";
  const category = typeof sp.category === "string" ? sp.category : "";

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, slug: true, isActive: true },
  });
  if (!client) notFound();

  const [parameters, categories, activePrompt] = await Promise.all([
    listParameters(clientId, { search, category }),
    listParameterCategories(clientId),
    prisma.clientAuditPrompt.findFirst({
      where: { clientId, isActive: true },
      orderBy: { versionNo: "desc" },
    }),
  ]);

  const activeParams = parameters.filter((p) => p.isActive);
  const totalScore = activeParams.reduce((s, p) => s + p.maxScore, 0);

  const defaultPromptText = generateDefaultPromptForClient({
    clientName: client.name,
    parameters: activeParams.map((p) => ({
      id: p.id,
      parameterCategory: p.parameterCategory,
      parameterName: p.parameterName,
      parameterDescription: p.parameterDescription,
      maxScore: p.maxScore,
      aiInstruction: p.aiInstruction,
    })),
  });

  return (
    <>
      <Topbar
        title={client.name}
        crumb="Parameters"
        right={
          <Link
            href="/parameters"
            className="h-9 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" /> Back to clients
          </Link>
        }
      />
      <PageShell className="html-page-bg px-[22px] py-[18px]">
        <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="html-card p-4">
            <div className="text-xs font-semibold text-slate-500">Client</div>
            <div className="mt-1 text-lg font-bold text-slate-800">{client.name}</div>
            <div className="text-xs text-slate-500">Code: <code className="font-mono">{client.slug}</code></div>
          </div>
          <div className="html-card p-4">
            <div className="text-xs font-semibold text-slate-500">Active parameters</div>
            <div className="mt-1 text-lg font-bold text-slate-800">{activeParams.length}</div>
            <div className="text-xs text-slate-500">{parameters.length} total (including inactive)</div>
          </div>
          <div className="html-card p-4">
            <div className="text-xs font-semibold text-slate-500">Total score (active)</div>
            <div className="mt-1 text-lg font-bold text-slate-800">{totalScore}</div>
            <div className="text-xs text-slate-500">Binary scoring per parameter</div>
          </div>
          <div className="html-card p-4">
            <div className="text-xs font-semibold text-slate-500">Audit prompt</div>
            <div className="mt-1 text-lg font-bold text-slate-800">
              {activePrompt ? `Custom · v${activePrompt.versionNo}` : "Generated"}
            </div>
            <div className="text-xs text-slate-500">
              {activePrompt
                ? "Loaded from DB at audit time"
                : "Built from active parameters at audit time"}
            </div>
          </div>
        </section>

        <ParameterEditor
          clientId={client.id}
          clients={[{ id: client.id, name: client.name }]}
          categories={categories}
          parameters={parameters.map((p) => ({
            id: p.id,
            parameterCategory: p.parameterCategory,
            parameterName: p.parameterName,
            parameterDescription: p.parameterDescription,
            maxScore: p.maxScore,
            aiInstruction: p.aiInstruction,
            displayOrder: p.displayOrder,
            isActive: p.isActive,
            scoreCount: p._count.aiParameterScores,
          }))}
          initialSearch={search}
          initialCategory={category}
        />

        <div id="prompt" className="mt-6">
          <PromptEditor
            clientId={client.id}
            clientName={client.name}
            defaultPromptText={defaultPromptText}
            customPrompt={
              activePrompt
                ? {
                    id: activePrompt.id,
                    promptName: activePrompt.promptName,
                    promptText: activePrompt.promptText,
                    versionNo: activePrompt.versionNo,
                  }
                : null
            }
          />
        </div>
      </PageShell>
    </>
  );
}
