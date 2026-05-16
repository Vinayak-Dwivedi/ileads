import { Topbar } from "@/components/layout/topbar";
import { PageShell } from "@/components/ui/page-shell";
import { requireSession } from "@/lib/auth";
import { listParameters, listParameterCategories } from "@/lib/data/parameters";
import { ParameterEditor } from "./editor";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ParametersPage({ searchParams }: PageProps) {
  const session = await requireSession();
  const sp = await searchParams;
  const search = typeof sp.q === "string" ? sp.q : "";
  const category = typeof sp.category === "string" ? sp.category : "";

  const [parameters, categories, clients] = await Promise.all([
    listParameters(session.clientId, { search, category }),
    listParameterCategories(session.clientId),
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <Topbar title="Parameters" />
      <PageShell className="html-page-bg px-[22px] py-[18px]">
        <ParameterEditor
          clientId={session.clientId}
          clients={clients}
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
      </PageShell>
    </>
  );
}
