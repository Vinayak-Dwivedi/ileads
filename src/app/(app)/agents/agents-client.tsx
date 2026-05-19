"use client";

import * as React from "react";
import { useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Power,
  Search,
  Trash2,
  User,
  UserPlus,
} from "lucide-react";
import { AddAgentDialog } from "@/components/layout/add-agent-dialog";
import { EmptyState, PageShell } from "@/components/ui/page-shell";
import { Pill } from "@/components/ui/pill";
import { deleteAgent, toggleAgentActive } from "./actions";

interface AgentWithRelations {
  id: string;
  name: string;
  employeeCode: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  campaign: { name: string } | null;
  team: { name: string } | null;
  _count: { calls: number };
}

interface AgentsClientProps {
  agents: AgentWithRelations[];
  campaigns: { id: string; name: string }[];
}

export function AgentsClient({ agents, campaigns }: AgentsClientProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const filteredAgents = agents.filter((agent) => {
    const term = searchQuery.toLowerCase();
    const matchesSearch =
      agent.name.toLowerCase().includes(term) ||
      (agent.employeeCode || "").toLowerCase().includes(term) ||
      (agent.email || "").toLowerCase().includes(term) ||
      (agent.team?.name || "").toLowerCase().includes(term) ||
      (agent.campaign?.name || "").toLowerCase().includes(term);
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && agent.isActive) ||
      (statusFilter === "inactive" && !agent.isActive);
    return matchesSearch && matchesStatus;
  });

  function handleToggle(agent: AgentWithRelations) {
    setNotice(null);
    setBusyAgentId(agent.id);
    startTransition(async () => {
      const result = await toggleAgentActive(agent.id, !agent.isActive);
      setBusyAgentId(null);
      setNotice({
        tone: result.ok ? "success" : "error",
        text: result.message ?? result.error ?? "Failed to update agent.",
      });
    });
  }

  function handleDelete(agent: AgentWithRelations) {
    setNotice(null);
    const confirmed = window.confirm(
      "Delete this agent? This is only allowed if there is no call history.",
    );
    if (!confirmed) return;

    setBusyAgentId(agent.id);
    startTransition(async () => {
      const result = await deleteAgent(agent.id);
      setBusyAgentId(null);
      setNotice({
        tone: result.ok ? "success" : "error",
        text:
          result.message ??
          result.error ??
          "This agent has call history and cannot be deleted. Deactivate the agent instead.",
      });
    });
  }

  return (
    <>
      <PageShell className="html-page-bg mx-auto w-full max-w-[1440px] px-4 py-4 md:px-6 md:py-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">Agents</h2>
            <p className="text-sm text-slate-500">Manage agents available for call audits.</p>
          </div>
          <button
            onClick={() => setIsAddOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
          >
            <UserPlus className="h-4 w-4" /> Add Agent
          </button>
        </div>

        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm md:flex-row md:items-center">
          <div className="relative w-full md:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by agent name, ID, team..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50/50 pl-10 pr-4 text-sm outline-none transition-all focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "all" | "active" | "inactive")}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          <div className="ml-auto text-xs font-medium text-slate-500">
            Showing {filteredAgents.length} of {agents.length} agents
          </div>
        </div>

        {notice ? (
          <div
            className={`mb-4 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
              notice.tone === "success"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {notice.tone === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{notice.text}</span>
          </div>
        ) : null}

        <section className="html-card overflow-hidden">
          <div className="html-section-header flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                {agents.length.toLocaleString()} agent{agents.length === 1 ? "" : "s"}
              </h3>
              <p className="text-xs text-slate-500">Database-backed roster</p>
            </div>
            <Pill tone="blue">{agents.filter((agent) => agent.isActive).length} active</Pill>
          </div>

          {filteredAgents.length === 0 ? (
            <EmptyState
              className="m-4"
              title="No agents found"
              description={
                searchQuery || statusFilter !== "all"
                  ? "No agents match the current filters."
                  : "Add your first agent to make them available for audits."
              }
              action={
                searchQuery ? (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="text-xs font-semibold text-blue-600 hover:underline"
                  >
                    Clear search filters
                  </button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] border-collapse text-sm">
                <thead>
                  <tr>
                    <Th>Agent</Th>
                    <Th>Agent ID</Th>
                    <Th>Email</Th>
                    <Th>Team</Th>
                    <Th>Campaign</Th>
                    <Th>Calls</Th>
                    <Th>Status</Th>
                    <Th>Date Added</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAgents.map((agent) => {
                    const isBusy = pending && busyAgentId === agent.id;
                    const hasHistory = agent._count.calls > 0;
                    return (
                      <tr key={agent.id} className="border-b border-[#edf1f6] hover:bg-[#fafcff]">
                        <Td>
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-100 bg-blue-50 text-xs font-semibold text-blue-700">
                              {initials(agent.name)}
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900">{agent.name}</div>
                              {hasHistory ? (
                                <div className="text-xs text-slate-500">Has call history</div>
                              ) : (
                                <div className="text-xs text-slate-400">No call history</div>
                              )}
                            </div>
                          </div>
                        </Td>
                        <Td className="font-mono text-xs font-semibold text-slate-600">
                          {agent.employeeCode || agent.id}
                        </Td>
                        <Td>{agent.email || "—"}</Td>
                        <Td>{agent.team?.name ?? "—"}</Td>
                        <Td>{agent.campaign?.name ?? "—"}</Td>
                        <Td className="font-mono text-slate-700">{agent._count.calls}</Td>
                        <Td>
                          <Pill tone={agent.isActive ? "green" : "slate"}>
                            {agent.isActive ? "Active" : "Inactive"}
                          </Pill>
                        </Td>
                        <Td className="text-xs text-slate-500">{agent.createdAt}</Td>
                        <Td>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleToggle(agent)}
                              disabled={pending}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              title={agent.isActive ? "Deactivate" : "Activate"}
                            >
                              <Power className="h-3.5 w-3.5" />
                              {agent.isActive ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              onClick={() => handleDelete(agent)}
                              disabled={pending}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                              title={
                                hasHistory
                                  ? "Call history exists. Deactivate instead."
                                  : isBusy
                                    ? "Deleting..."
                                    : "Delete"
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </PageShell>

      {/* Add Agent Dialog Modal */}
      <AddAgentDialog
        isOpen={isAddOpen}
        onOpenChange={setIsAddOpen}
        campaigns={campaigns}
      />
    </>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || <User className="h-4 w-4" />;
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={`html-table-head whitespace-nowrap ${className ?? ""}`}>{children}</th>;
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`html-table-cell whitespace-nowrap ${className ?? ""}`}>{children}</td>;
}
