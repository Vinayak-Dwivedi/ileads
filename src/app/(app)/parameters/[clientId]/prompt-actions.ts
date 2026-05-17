"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";

const MAX_PROMPT_LENGTH = 32_000;

async function assertClientAccess(clientId: string) {
  const session = await requireSession();
  if (clientId !== session.clientId) {
    const access = await prisma.clientAccess.findFirst({
      where: { id: session.accessId, clientId },
    });
    if (!access) throw new Error("You don't have access to that client.");
  }
}

export async function saveClientPrompt(input: {
  clientId: string;
  promptText: string;
  promptName?: string;
}): Promise<{ ok: boolean; versionNo?: number; error?: string }> {
  try {
    if (!input.clientId) throw new Error("Missing client id.");
    const text = (input.promptText ?? "").trim();
    if (text.length === 0) throw new Error("Prompt cannot be empty.");
    if (text.length > MAX_PROMPT_LENGTH)
      throw new Error(`Prompt too long (max ${MAX_PROMPT_LENGTH} characters).`);

    await assertClientAccess(input.clientId);

    const result = await prisma.$transaction(async (tx) => {
      const prior = await tx.clientAuditPrompt.findFirst({
        where: { clientId: input.clientId },
        orderBy: { versionNo: "desc" },
        select: { versionNo: true },
      });
      const nextVersion = (prior?.versionNo ?? 0) + 1;
      await tx.clientAuditPrompt.updateMany({
        where: { clientId: input.clientId, isActive: true },
        data: { isActive: false },
      });
      const created = await tx.clientAuditPrompt.create({
        data: {
          clientId: input.clientId,
          promptName: input.promptName?.trim() || "Custom audit prompt",
          promptText: text,
          isActive: true,
          versionNo: nextVersion,
        },
      });
      return created;
    });

    revalidatePath(`/parameters/${input.clientId}`);
    revalidatePath("/parameters");
    return { ok: true, versionNo: result.versionNo };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

export async function resetClientPromptToDefault(input: {
  clientId: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!input.clientId) throw new Error("Missing client id.");
    await assertClientAccess(input.clientId);
    await prisma.clientAuditPrompt.updateMany({
      where: { clientId: input.clientId, isActive: true },
      data: { isActive: false },
    });
    revalidatePath(`/parameters/${input.clientId}`);
    revalidatePath("/parameters");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Reset failed." };
  }
}
