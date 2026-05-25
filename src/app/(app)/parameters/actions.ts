"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";

export interface ParameterActionResult {
  ok: boolean;
  error?: string;
}

interface ParameterInput {
  id?: string;
  clientId: string;
  standardParameterId?: string;
  parameterCategory: string;
  parameterName: string;
  parameterDescription: string;
  maxScore: number;
  aiInstruction: string;
  displayOrder: number;
  isActive: boolean;
}

function parseInput(formData: FormData): ParameterInput {
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const id = get("id") || undefined;
  const clientId = get("clientId");
  const standardParameterId = get("standardParameterId") || undefined;
  const parameterCategory = get("parameterCategory");
  const parameterName = get("parameterName");
  const parameterDescription = get("parameterDescription");
  const aiInstruction = get("aiInstruction");
  const maxScore = Number(get("maxScore") || "0");
  const displayOrder = Number(get("displayOrder") || "0");
  const isActive = formData.get("isActive") != null;

  if (!clientId) throw new Error("Client is required.");
  if (!parameterName) throw new Error("Parameter name is required.");
  if (!parameterDescription) throw new Error("Description is required.");
  if (!Number.isInteger(maxScore) || maxScore <= 0)
    throw new Error("Max score must be a positive integer.");
  if (!Number.isFinite(displayOrder)) throw new Error("Display order must be a number.");

  return {
    id,
    clientId,
    standardParameterId,
    parameterCategory: parameterCategory || "General",
    parameterName,
    parameterDescription,
    maxScore,
    aiInstruction: aiInstruction || "",
    displayOrder,
    isActive,
  };
}

async function assertClientAccess(clientId: string) {
  const session = await requireSession();
  // For now the session is single-tenant; require an exact match.
  if (clientId !== session.clientId) {
    const access = await prisma.clientAccess.findFirst({
      where: { id: session.accessId, clientId },
    });
    if (!access) throw new Error("You don't have access to that client.");
  }
}

function revalidateParameterRoutes(clientId: string) {
  // "layout" scope re-renders the dynamic [clientId] child segment as well.
  revalidatePath("/parameters", "layout");
  revalidatePath(`/parameters/${clientId}`);
  revalidatePath("/dashboard");
}

export async function upsertParameter(
  formData: FormData,
): Promise<ParameterActionResult> {
  try {
    const input = parseInput(formData);
    await assertClientAccess(input.clientId);

    const standardParam = input.standardParameterId
      ? await prisma.standardAuditParameter.findUnique({
          where: { id: input.standardParameterId },
          select: { id: true, name: true },
        })
      : await prisma.standardAuditParameter.findUnique({
          where: { name: input.parameterCategory },
          select: { id: true, name: true },
        });
    if (!standardParam) {
      return { ok: false, error: "Standard KPI category is required." };
    }
    const parameterCategory = standardParam.name;
    const standardParameterId = standardParam.id;

    if (input.id) {
      const existing = await prisma.clientParameter.findFirst({
        where: { id: input.id, clientId: input.clientId },
        select: { id: true },
      });
      if (!existing) return { ok: false, error: "Parameter not found." };
      await prisma.clientParameter.update({
        where: { id: existing.id },
        data: {
          parameterCategory,
          parameterName: input.parameterName,
          parameterDescription: input.parameterDescription,
          maxScore: input.maxScore,
          aiInstruction: input.aiInstruction,
          displayOrder: input.displayOrder,
          isActive: input.isActive,
          standardParameterId,
        },
      });
    } else {
      await prisma.clientParameter.create({
        data: {
          clientId: input.clientId,
          parameterCategory,
          parameterName: input.parameterName,
          parameterDescription: input.parameterDescription,
          maxScore: input.maxScore,
          aiInstruction: input.aiInstruction,
          displayOrder: input.displayOrder,
          isActive: input.isActive,
          standardParameterId,
        },
      });
    }
    revalidateParameterRoutes(input.clientId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save parameter." };
  }
}

export async function toggleParameterActive(
  formData: FormData,
): Promise<ParameterActionResult> {
  try {
    const id = String(formData.get("id") ?? "");
    if (!id) return { ok: false, error: "Missing parameter id." };
    const param = await prisma.clientParameter.findUnique({
      where: { id },
      select: { id: true, clientId: true, isActive: true },
    });
    if (!param) return { ok: false, error: "Parameter not found." };
    await assertClientAccess(param.clientId);
    await prisma.clientParameter.update({
      where: { id: param.id },
      data: { isActive: !param.isActive },
    });
    revalidateParameterRoutes(param.clientId);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to update parameter.",
    };
  }
}

export async function deleteParameter(
  formData: FormData,
): Promise<ParameterActionResult> {
  try {
    const id = String(formData.get("id") ?? "");
    if (!id) return { ok: false, error: "Missing parameter id." };
    const param = await prisma.clientParameter.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        _count: { select: { aiParameterScores: true } },
      },
    });
    if (!param) return { ok: false, error: "Parameter not found." };
    await assertClientAccess(param.clientId);
    if (param._count.aiParameterScores > 0) {
      return {
        ok: false,
        error:
          "This parameter has audit history and cannot be deleted. Deactivate it instead.",
      };
    }
    await prisma.clientParameter.delete({ where: { id: param.id } });
    revalidateParameterRoutes(param.clientId);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to delete parameter.",
    };
  }
}

export interface AddAgentActionResult {
  ok: boolean;
  error?: string;
}

export async function addAgent(
  formData: FormData,
): Promise<AddAgentActionResult> {
  try {
    const session = await requireSession();
    const clientId = session.clientId;

    const name = String(formData.get("name") ?? "").trim();
    const employeeCode = String(formData.get("employeeCode") ?? "").trim();
    const campaignId = String(formData.get("campaignId") ?? "").trim();

    if (!name) {
      return { ok: false, error: "Agent name is required." };
    }
    if (!employeeCode) {
      return { ok: false, error: "Agent ID is required." };
    }
    if (!campaignId) {
      return { ok: false, error: "Campaign is required." };
    }

    // Check if agent with this employee code already exists for this client
    const existing = await prisma.agent.findFirst({
      where: { clientId, employeeCode },
    });
    if (existing) {
      return { ok: false, error: `Agent ID "${employeeCode}" already exists.` };
    }

    // Create the agent in the database
    await prisma.agent.create({
      data: {
        clientId,
        name,
        employeeCode,
        campaignId,
        isActive: true,
      },
    });

    // Revalidate routes to update filter options across the app
    revalidatePath("/dashboard");
    revalidatePath("/calls");
    revalidatePath("/agents");

    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to add agent.",
    };
  }
}
