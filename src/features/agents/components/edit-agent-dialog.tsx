"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, PencilLineIcon } from "lucide-react";

import { updateAgent } from "@/features/agents/actions/agents";
import type { AgentCampaignOption, AgentTableRow } from "@/features/agents/api/agents";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface EditAgentDialogProps {
  agent: AgentTableRow | null;
  campaigns: AgentCampaignOption[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditAgentDialog({
  agent,
  campaigns,
  isOpen,
  onOpenChange,
}: EditAgentDialogProps) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!isOpen) setError(null);
  }, [isOpen]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!agent) return;

    const form = event.currentTarget;
    const formData = new FormData(form);
    if (formData.get("campaignId") === "__none") {
      formData.set("campaignId", "");
    }

    startTransition(async () => {
      const result = await updateAgent(formData);
      if (result.ok) {
        onOpenChange(false);
        router.refresh();
        return;
      }

      setError(result.error ?? "Failed to update agent.");
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden border-slate-200 bg-white p-0 shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
        <DialogHeader className="border-b border-slate-100 px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-xl text-slate-900">
            <PencilLineIcon className="h-5 w-5 text-blue-600" />
            Edit Agent
          </DialogTitle>
          <DialogDescription>
            Update the agent details and campaign assignment.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid grid-rows-[1fr_auto]">
          <div className="space-y-4 overflow-y-auto px-6 py-5">
            <input type="hidden" name="agentId" value={agent?.id ?? ""} />
            <Field>
              <FieldLabel htmlFor="edit-agent-name">Agent Name</FieldLabel>
              <Input
                id="edit-agent-name"
                name="name"
                required
                defaultValue={agent?.name ?? ""}
                placeholder="Enter agent name"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="edit-employee-code">Agent ID</FieldLabel>
              <Input
                id="edit-employee-code"
                name="employeeCode"
                required
                defaultValue={agent?.employeeCode ?? ""}
                placeholder="Enter agent ID"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="edit-agent-campaign">Campaign</FieldLabel>
              <Select name="campaignId" defaultValue={agent?.campaignId ?? "__none"}>
                <SelectTrigger id="edit-agent-campaign" className="w-full bg-white">
                  <SelectValue placeholder="No campaign" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="__none">No campaign</SelectItem>
                    {campaigns.map((campaign) => (
                      <SelectItem key={campaign.id} value={campaign.id}>
                        {campaign.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            {error ? (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/80 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
