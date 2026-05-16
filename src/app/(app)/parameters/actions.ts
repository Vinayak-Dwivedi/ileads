"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";

interface ParameterInput {
  id?: string;
  clientId: string;
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

export async function upsertParameter(formData: FormData) {
  const input = parseInput(formData);
  await assertClientAccess(input.clientId);
  if (input.id) {
    await prisma.clientParameter.update({
      where: { id: input.id },
      data: {
        parameterCategory: input.parameterCategory,
        parameterName: input.parameterName,
        parameterDescription: input.parameterDescription,
        maxScore: input.maxScore,
        aiInstruction: input.aiInstruction,
        displayOrder: input.displayOrder,
        isActive: input.isActive,
      },
    });
  } else {
    await prisma.clientParameter.create({
      data: {
        clientId: input.clientId,
        parameterCategory: input.parameterCategory,
        parameterName: input.parameterName,
        parameterDescription: input.parameterDescription,
        maxScore: input.maxScore,
        aiInstruction: input.aiInstruction,
        displayOrder: input.displayOrder,
        isActive: input.isActive,
      },
    });
  }
  revalidatePath("/parameters");
}

export async function toggleParameterActive(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id.");
  const session = await requireSession();
  const param = await prisma.clientParameter.findFirst({
    where: { id, clientId: session.clientId },
  });
  if (!param) throw new Error("Parameter not found.");
  await prisma.clientParameter.update({
    where: { id: param.id },
    data: { isActive: !param.isActive },
  });
  revalidatePath("/parameters");
}

export async function deleteParameter(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id.");
  const session = await requireSession();
  const param = await prisma.clientParameter.findFirst({
    where: { id, clientId: session.clientId },
    include: { _count: { select: { aiParameterScores: true } } },
  });
  if (!param) throw new Error("Parameter not found.");
  if (param._count.aiParameterScores > 0) {
    throw new Error(
      "Parameter has audit history and cannot be deleted. Deactivate it instead.",
    );
  }
  await prisma.clientParameter.delete({ where: { id: param.id } });
  revalidatePath("/parameters");
}
