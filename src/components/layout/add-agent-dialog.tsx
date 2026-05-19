"use client";

import * as React from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { addAgent } from "@/app/(app)/parameters/actions";

interface AddAgentDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  campaigns: { id: string; name: string }[];
}

export function AddAgentDialog({ isOpen, onOpenChange, campaigns }: AddAgentDialogProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      const res = await addAgent(formData);
      if (res.ok) {
        onOpenChange(false);
        form.reset();
        router.refresh();
      } else {
        setError(res.error ?? "Failed to add agent.");
      }
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden border-slate-200 bg-white p-0 shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
        <DialogHeader className="border-b border-slate-100 px-6 py-5">
          <DialogTitle className="text-xl text-slate-900 flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-blue-600" />
            Add Agent
          </DialogTitle>
          <DialogDescription>
            Add a new agent to the system and assign them to a campaign.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid grid-rows-[1fr_auto]">
          <div className="overflow-y-auto px-6 py-5 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">
                Agent Name <span className="text-red-500">*</span>
              </span>
              <input
                type="text"
                name="name"
                required
                placeholder="Enter agent name"
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">
                Agent ID <span className="text-red-500">*</span>
              </span>
              <input
                type="text"
                name="employeeCode"
                required
                placeholder="Enter agent ID"
                className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">
                Campaign
              </span>
              <select
                name="campaignId"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="">No campaign</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </label>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/80 px-6 py-4">
           
            <button
              type="submit"
              disabled={pending}
              className="h-10 rounded-md bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {pending ? "Adding..." : "Add agent"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
