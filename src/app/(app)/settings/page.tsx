import { Topbar } from "@/components/layout/topbar";
import { PageShell } from "@/components/ui/page-shell";
import { Pill } from "@/components/ui/pill";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BASE_PATH } from "@/lib/base-path";
import {
  ShieldCheck,
  Database,
  Sparkles,
  Globe,
  KeyRound,
  Server,
  Layers,
} from "lucide-react";

export const dynamic = "force-dynamic";

async function dbStatus(): Promise<"connected" | "down"> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "connected";
  } catch {
    return "down";
  }
}

export default async function SettingsPage() {
  const session = await requireSession();
  const status = await dbStatus();
  const aiKey = process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.length > 0;
  const aiModel = process.env.OPENROUTER_MODEL ?? "openrouter/auto";
  const appBaseUrl = process.env.APP_BASE_URL ?? "http://187.127.139.47/ileads-qms";
  const basePath = BASE_PATH || "/";

  return (
    <>
      <Topbar title="Settings" crumb="Environment" />
      <PageShell>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Section title="Application">
            <Row icon={<Globe className="h-4 w-4" />} label="App mode">
              <Pill tone="blue">{process.env.NODE_ENV ?? "development"}</Pill>
            </Row>
            <Row icon={<Server className="h-4 w-4" />} label="Base URL">
              <code className="text-xs text-slate-700">{appBaseUrl}</code>
            </Row>
            <Row icon={<Layers className="h-4 w-4" />} label="Base path">
              <code className="text-xs text-slate-700">{basePath}</code>
            </Row>
            <Row icon={<ShieldCheck className="h-4 w-4" />} label="Auth mode">
              <Pill tone="green">Simple password</Pill>
            </Row>
          </Section>

          <Section title="Data &amp; AI">
            <Row icon={<Database className="h-4 w-4" />} label="Database">
              <Pill tone={status === "connected" ? "green" : "red"}>
                {status === "connected" ? "Connected" : "Down"}
              </Pill>
            </Row>
            <Row icon={<Sparkles className="h-4 w-4" />} label="OpenRouter model">
              <code className="text-xs text-slate-700">{aiModel}</code>
            </Row>
            <Row icon={<KeyRound className="h-4 w-4" />} label="OpenRouter API key">
              <Pill tone={aiKey ? "green" : "slate"}>{aiKey ? "Loaded" : "Not set"}</Pill>
            </Row>
            <Row icon={<Sparkles className="h-4 w-4" />} label="AI audit status">
              <Pill tone="yellow">Placeholder — not wired to a live model</Pill>
            </Row>
          </Section>

          <Section title="Workspace">
            <Row label="Client">{session.clientName}</Row>
            <Row label="Access ID">
              <code className="text-xs text-slate-500">{session.accessId}</code>
            </Row>
            <Row label="Tenancy">
              <Pill tone="blue">Single workspace</Pill>
            </Row>
          </Section>

          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-5 text-sm text-slate-500 leading-relaxed">
            <p className="text-slate-700 font-medium mb-1">Secrets &amp; keys</p>
            API keys, session secrets, and DB credentials are never displayed in this UI. To rotate
            them, update the environment file on the host and restart the app container.
          </div>
        </div>
      </PageShell>
    </>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <h3 className="text-sm font-bold text-slate-800 mb-3">{title}</h3>
      <div className="divide-y divide-slate-100">{children}</div>
    </section>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2.5 text-sm text-slate-600">
        {icon ? <span className="text-slate-400">{icon}</span> : null}
        <span>{label}</span>
      </div>
      <div className="text-right">{children}</div>
    </div>
  );
}
