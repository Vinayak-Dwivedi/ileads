"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { runAuditForCall } from "@/services/audit";
import { runMockTranscriptionForCall } from "@/services/transcription";

export async function saveManualReview(formData: FormData) {
  const session = await requireSession();
  const callId = String(formData.get("callId") ?? "");
  const reviewerName = String(formData.get("reviewerName") ?? "").trim();
  const status = String(formData.get("status") ?? "PENDING") as
    | "PENDING"
    | "IN_PROGRESS"
    | "COMPLETED";
  const disposition = String(formData.get("disposition") ?? "").trim();
  const scoreRaw = String(formData.get("score") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!callId) throw new Error("Missing call id.");
  if (!reviewerName) throw new Error("Reviewer name is required.");

  const score = scoreRaw === "" ? null : Number(scoreRaw);
  if (score != null && (Number.isNaN(score) || score < 0 || score > 100)) {
    throw new Error("Manual score must be between 0 and 100.");
  }

  const call = await prisma.call.findFirst({
    where: { id: callId, clientId: session.clientId },
    select: { id: true, aiScore: true, manualReviews: { take: 1, orderBy: { createdAt: "desc" } } },
  });
  if (!call) throw new Error("Call not found.");

  const existing = call.manualReviews[0];

  await prisma.$transaction(async (tx) => {
    if (existing) {
      await tx.manualReview.update({
        where: { id: existing.id },
        data: {
          reviewerName,
          status,
          score: score ?? null,
          maxScore: score != null ? 100 : null,
          scorePercent: score ?? null,
          notes: notes || null,
          startedAt: existing.startedAt ?? new Date(),
          completedAt: status === "COMPLETED" ? new Date() : null,
        },
      });
    } else {
      await tx.manualReview.create({
        data: {
          callId,
          reviewerName,
          status,
          score: score ?? null,
          maxScore: score != null ? 100 : null,
          scorePercent: score ?? null,
          notes: notes || null,
          startedAt: new Date(),
          completedAt: status === "COMPLETED" ? new Date() : null,
        },
      });
    }

    await tx.call.update({
      where: { id: callId },
      data: {
        manualScore: score,
        manualDisposition: disposition || null,
        finalScore: score ?? call.aiScore ?? null,
      },
    });

    await tx.callEvent.create({
      data: {
        callId,
        eventType: status === "COMPLETED" ? "MANUAL_REVIEW_COMPLETED" : "MANUAL_REVIEW_STARTED",
        payload: { reviewerName, status, score, disposition },
      },
    });
  });

  revalidatePath(`/calls/${callId}`);
  revalidatePath("/calls");
  revalidatePath("/dashboard");
}

export interface MockAuditDebugInfo {
  promptVersion: string;
  prompt: string;
  rawResponse: unknown;
  validated: unknown;
  warnings: string[];
  auditId: string;
  auditRunNo: number;
}

export async function runMockTranscription(callId: string) {
  if (!callId) throw new Error("Missing call id.");
  const session = await requireSession();
  const result = await runMockTranscriptionForCall(callId, session.clientId);
  revalidatePath(`/calls/${callId}`);
  revalidatePath("/calls");
  revalidatePath("/dashboard");
  return result;
}

export async function runMockAudit(callId: string): Promise<MockAuditDebugInfo> {
  if (!callId) throw new Error("Missing call id.");
  const session = await requireSession();
  const result = await runAuditForCall(callId, session.clientId, { mode: "mock" });
  revalidatePath(`/calls/${callId}`);
  revalidatePath("/calls");
  revalidatePath("/dashboard");
  return {
    promptVersion: result.promptVersion,
    prompt: result.prompt,
    rawResponse: result.rawResponse,
    validated: result.validated,
    warnings: result.validated.warnings,
    auditId: result.audit.auditId,
    auditRunNo: result.audit.auditRunNo,
  };
}

export async function addCallNote(formData: FormData) {
  const session = await requireSession();
  const callId = String(formData.get("callId") ?? "");
  const authorName = String(formData.get("authorName") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!callId || !authorName || !body) {
    throw new Error("Author name and note text are required.");
  }

  const call = await prisma.call.findFirst({
    where: { id: callId, clientId: session.clientId },
    select: { id: true, transcript: { select: { id: true } } },
  });
  if (!call) throw new Error("Call not found.");
  if (!call.transcript) {
    throw new Error("No transcript available. Run transcription first when STT is enabled.");
  }

  await prisma.$transaction([
    prisma.callNote.create({
      data: { callId, authorName, body },
    }),
    prisma.callEvent.create({
      data: { callId, eventType: "NOTE_ADDED", payload: { authorName } },
    }),
  ]);

  revalidatePath(`/calls/${callId}`);
}
