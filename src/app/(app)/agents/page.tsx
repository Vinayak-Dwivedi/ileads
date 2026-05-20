import { requireSession } from "@/lib/auth";
import { getAgentsPageData } from "@/features/agents/api/agents";
import { AgentsTable } from "@/features/agents/components/agents-table";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const session = await requireSession();
  const { agents, campaigns } = await getAgentsPageData(session.clientId);

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 p-4 md:gap-5 md:p-6">
          <AgentsTable agents={agents} campaigns={campaigns} />
        </div>
      </div>
    </div>
  );
}
