"use client";

import * as React from "react";
import { useState, useTransition } from "react";
import { UserPlus, Search, User, ShieldAlert, BadgeInfo } from "lucide-react";
import { AddAgentDialog } from "@/components/layout/add-agent-dialog";
import { PageShell } from "@/components/ui/page-shell";
import { Pill } from "@/components/ui/pill";

interface AgentWithRelations {
  id: string;
  name: string;
  employeeCode: string | null;
  isActive: boolean;
  createdAt: string;
  campaign: { name: string } | null;
  team: { name: string } | null;
}

interface AgentsClientProps {
  agents: AgentWithRelations[];
  campaigns: { id: string; name: string }[];
}

export function AgentsClient({ agents, campaigns }: AgentsClientProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);

  // Client-side instant filter
  const filteredAgents = agents.filter((agent) => {
    const term = searchQuery.toLowerCase();
    return (
      agent.name.toLowerCase().includes(term) ||
      (agent.employeeCode || "").toLowerCase().includes(term) ||
      (agent.campaign?.name || "").toLowerCase().includes(term)
    );
  });

  return (
    <>
      <PageShell className="html-page-bg mx-auto w-full max-w-[1440px] px-4 py-4 md:px-6 md:py-6">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-slate-900">Agents</h2>
            <p className="text-sm text-slate-500">
              Manage and assign agents to campaigns, view status, and track agent codes.
            </p>
          </div>
          <button
            onClick={() => setIsAddOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-700 active:scale-95"
          >
            <UserPlus className="h-4 w-4" /> Add Agent
          </button>
        </div>

        {/* Search and Filters Bar */}
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by agent name, ID, or campaign..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50/50 pl-10 pr-4 text-sm outline-none transition-all focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="text-xs font-medium text-slate-400 ml-auto">
            Showing {filteredAgents.length} of {agents.length} agents
          </div>
        </div>

        {/* Main Content Area */}
        <div className="html-card overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {filteredAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="rounded-full bg-slate-50 p-4 border border-slate-100 mb-4">
                <User className="h-8 w-8 text-slate-400" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">No agents found</h3>
              <p className="mt-1 text-sm text-slate-500 max-w-xs">
                {searchQuery ? "No agents match your search queries." : "Add your first agent to get started."}
              </p>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="mt-4 text-xs font-semibold text-blue-600 hover:underline"
                >
                  Clear search filters
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="html-table-head py-3.5 px-6 font-semibold text-slate-600">Agent Name</th>
                    <th className="html-table-head py-3.5 px-6 font-semibold text-slate-600">Agent ID</th>
                    <th className="html-table-head py-3.5 px-6 font-semibold text-slate-600 text-center">Status</th>
                    <th className="html-table-head py-3.5 px-6 font-semibold text-slate-600">Campaign</th>
                    <th className="html-table-head py-3.5 px-6 font-semibold text-slate-600">Date Added</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAgents.map((agent) => (
                    <tr
                      key={agent.id}
                      className="group transition-colors hover:bg-slate-50/70"
                    >
                      <td className="py-4 px-6 font-medium text-slate-900">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700 font-semibold text-xs border border-blue-100">
                            {agent.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                          <span>{agent.name}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6 font-mono text-xs font-semibold text-slate-600">
                        {agent.employeeCode || "—"}
                      </td>
                      <td className="py-4 px-6 text-center">
                        <Pill tone={agent.isActive ? "green" : "slate"}>
                          {agent.isActive ? "Active" : "Inactive"}
                        </Pill>
                      </td>
                      <td className="py-4 px-6 text-slate-700 font-medium">
                        {agent.campaign ? (
                          <div className="flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-500"></span>
                            {agent.campaign.name}
                          </div>
                        ) : (
                          <span className="text-slate-400 font-normal italic">No campaign</span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-xs text-slate-500">
                        {agent.createdAt}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
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
