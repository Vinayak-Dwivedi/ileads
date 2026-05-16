import { Topbar } from "@/components/layout/topbar";
import { PageShell } from "@/components/ui/page-shell";
import { requireSession } from "@/lib/auth";
import { listClients } from "@/lib/data/clients";
import { ClientsEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const session = await requireSession();
  const clients = await listClients();
  return (
    <>
      <Topbar title="Clients" crumb="Tenants" />
      <PageShell>
        <ClientsEditor
          currentClientId={session.clientId}
          clients={clients.map((c) => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
            industry: c.industry,
            contactEmail: c.contactEmail,
            isActive: c.isActive,
            counts: {
              calls: c._count.calls,
              agents: c._count.agents,
              campaigns: c._count.campaigns,
              parameters: c._count.parameters,
              teams: c._count.teams,
            },
          }))}
        />
      </PageShell>
    </>
  );
}
