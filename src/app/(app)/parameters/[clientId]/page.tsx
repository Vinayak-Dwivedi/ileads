import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import { Pill } from "@/components/ui/pill";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listParameters, listParameterCategories, listStandardParameterOptions } from "@/lib/data/parameters";
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

  const [parameters, categories, standardKpis, activePrompt] = await Promise.all([
    listParameters(clientId, { search, category }),
    listParameterCategories(clientId),
    listStandardParameterOptions(),
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
      parameterCategory: p.standardParameter?.name ?? p.parameterCategory,
      parameterName: p.parameterName,
      parameterDescription: p.parameterDescription,
      maxScore: p.maxScore,
      aiInstruction: p.aiInstruction,
    })),
  });

  return (
    <>
      <PageShell className="html-page-bg mx-auto w-full max-w-[1440px] px-4 py-4 md:px-6 md:py-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
         
           </div>
        <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="html-card p-4">
            <div className="text-xs font-semibold text-slate-500">Client</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{client.name}</div>
             </div>
          <div className="html-card p-4">
            <div className="text-xs font-semibold text-slate-500">Active parameters</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{activeParams.length}</div>
        
          </div>
          <div className="html-card p-4">
            <div className="text-xs font-semibold text-slate-500">Total score</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{totalScore}</div>
           
          </div>
        </section>

        <ParameterEditor
          clientId={client.id}
          clients={[{ id: client.id, name: client.name }]}
          categories={categories}
          standardKpis={standardKpis}
          parameters={parameters.map((p) => ({
            id: p.id,
            parameterCategory: p.standardParameter?.name ?? p.parameterCategory,
            standardParameterId: p.standardParameter?.id ?? null,
            standardParameterName: p.standardParameter?.name ?? null,
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
