"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export interface AgentActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

function revalidateAgentRoutes() {
  revalidatePath("/agents");
  revalidatePath("/calls");
  revalidatePath("/dashboard");
}

async function getSessionAgent(agentId: string) {
  const session = await requireSession();
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, clientId: session.clientId },
    select: { id: true, clientId: true, name: true, isActive: true },
  });

  return { session, agent };
}

export async function addAgent(formData: FormData): Promise<AgentActionResult> {
  try {
    const session = await requireSession();
    const clientId = session.clientId;

    const name = String(formData.get("name") ?? "").trim();
    const employeeCode = String(formData.get("employeeCode") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim() || null;
    const campaignId = String(formData.get("campaignId") ?? "").trim() || null;

    if (!name) return { ok: false, error: "Agent name is required." };
    if (!employeeCode) return { ok: false, error: "Agent ID is required." };

    // TODO: remove this duplicate creation logic after parameter/agent actions
    // are fully split into feature-owned modules.
    const existing = await prisma.agent.findFirst({
      where: { clientId, employeeCode },
    });
    if (existing) {
      return { ok: false, error: `Agent ID "${employeeCode}" already exists.` };
    }

    await prisma.agent.create({
      data: {
        clientId,
        name,
        employeeCode,
        email,
        campaignId,
        isActive: true,
      },
    });

    revalidateAgentRoutes();
    return { ok: true, message: "Agent added successfully." };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to add agent.",
    };
  }
}

export async function deleteAgent(agentId: string): Promise<AgentActionResult> {
  try {
    if (!agentId) return { ok: false, error: "Missing agent id." };

    const { session, agent } = await getSessionAgent(agentId);
    if (!agent) return { ok: false, error: "Agent not found." };

    const relatedCalls = await prisma.call.count({
      where: { agentId: agent.id, clientId: session.clientId },
    });

    if (relatedCalls > 0) {
      return {
        ok: false,
        error:
          "This agent has call history and cannot be deleted. Deactivate the agent instead.",
      };
    }

    await prisma.agent.delete({ where: { id: agent.id } });
    revalidateAgentRoutes();
    return { ok: true, message: "Agent deleted successfully." };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to delete agent.",
    };
  }
}

export async function toggleAgentActive(
  agentId: string,
  isActive: boolean,
): Promise<AgentActionResult> {
  try {
    if (!agentId) return { ok: false, error: "Missing agent id." };

    const { agent } = await getSessionAgent(agentId);
    if (!agent) return { ok: false, error: "Agent not found." };

    await prisma.agent.update({
      where: { id: agent.id },
      data: { isActive },
    });

    revalidateAgentRoutes();
    return {
      ok: true,
      message: isActive
        ? "Agent activated successfully."
        : "Agent deactivated successfully.",
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to update agent.",
    };
  }
}
