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
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to delete agent.",
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
      message: isActive ? "Agent activated successfully." : "Agent deactivated successfully.",
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to update agent.",
    };
  }
}
