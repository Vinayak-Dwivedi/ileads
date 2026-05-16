import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import type { AuditCallContext, ValidatedAuditResponse } from "./types";

export interface SaveAuditOptions {
  callId: string;
  ctx: AuditCallContext;
  validated: ValidatedAuditResponse;
  prompt: string;
  promptVersion: string;
  rawResponse: unknown;
  auditMode: "mock" | "live";
  modelUsed: string | null;
}

export interface SaveAuditResult {
  auditId: string;
  auditRunNo: number;
  isLatest: boolean;
}

/**
 * Save a validated audit response into the database.
 *
 * Behaviour:
 *   - Previous ai_audits rows for the same call have `isLatest` flipped off.
 *   - Inserts a new ai_audits row with `auditRunNo = (max prior + 1)`.
 *   - Replaces ai_parameter_scores for this audit.
 *   - Replaces the *audit-derived* events for this audit (CALL_IMPORTED,
 *     TRANSCRIPT_READY, MANUAL_REVIEW_*, NOTE_ADDED are preserved).
 *   - Updates calls.aiScore, calls.sentiment, calls.finalScore (final =
 *     manualScore ?? aiScore).
 *   - All inside one Prisma transaction.
 */
export async function saveAuditResult(opts: SaveAuditOptions): Promise<SaveAuditResult> {
  const { callId, validated, prompt, promptVersion, rawResponse, auditMode, modelUsed } = opts;

  const result = await prisma.$transaction(async (tx) => {
    const prior = await tx.aiAudit.findFirst({
      where: { callId },
      orderBy: { auditRunNo: "desc" },
      select: { auditRunNo: true },
    });
    const nextRunNo = (prior?.auditRunNo ?? 0) + 1;

    await tx.aiAudit.updateMany({
      where: { callId, isLatest: true },
      data: { isLatest: false },
    });

    const audit = await tx.aiAudit.create({
      data: {
        callId,
        auditMode,
        auditRunNo: nextRunNo,
        isLatest: true,
        modelUsed,
        promptVersion,
        status: "COMPLETED",
        overallScore: validated.overallScore,
        maxPossibleScore: validated.maxPossibleScore,
        scorePercent: validated.scorePercent,
        summary: validated.summary || null,
        sentiment: validated.sentiment,
        agentTone: validated.agentTone || null,
        customerEmotion: validated.customerEmotion || null,
        hasComplianceIssue: validated.hasComplianceIssue,
        complianceSeverity: validated.complianceSeverity,
        improvementArea: validated.improvementArea || null,
        coachingRecommendation: validated.coachingRecommendation || null,
        nextBestAction: validated.nextBestAction || null,
        agentStrengths: validated.agentStrengths as unknown as Prisma.InputJsonValue,
        agentWeaknesses: validated.agentWeaknesses as unknown as Prisma.InputJsonValue,
        customerObjections: validated.customerObjections as unknown as Prisma.InputJsonValue,
        complianceIssues: validated.complianceIssues as unknown as Prisma.InputJsonValue,
        promptText: prompt,
        rawAiResponse: rawResponse as Prisma.InputJsonValue,
        validatedResponse: validated as unknown as Prisma.InputJsonValue,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });

    if (validated.parameterScores.length > 0) {
      await tx.aiParameterScore.createMany({
        data: validated.parameterScores.map((p) => ({
          aiAuditId: audit.id,
          parameterId: p.parameterId,
          result: p.result,
          score: p.awardedScore,
          maxScore: p.maxScore,
          isPassed: p.result === "PASS",
          reasoning: p.reason,
          evidenceText: p.evidenceText,
          evidenceStartSeconds: p.evidenceStartSeconds,
          evidenceEndSeconds: p.evidenceEndSeconds,
          confidenceScore: p.confidenceScore,
        })),
      });
    }

    // Audit-derived events for the new run. We delete any previous
    // audit-derived events so re-running doesn't pile them up — manual
    // events (CALL_IMPORTED, TRANSCRIPT_READY, NOTE_ADDED, MANUAL_REVIEW_*)
    // are preserved.
    const auditEventTypes = [
      "AUDIT_QUEUED",
      "AUDIT_STARTED",
      "AUDIT_COMPLETED",
      "AUDIT_FAILED",
      "COMPLIANCE_ISSUE",
      "CUSTOMER_OBJECTION",
      "ESCALATION_RISK",
      "EMPATHY_GAP",
      "SCRIPT_DEVIATION",
      "POSSIBLE_RAISED_TONE",
      "RUDE_LANGUAGE",
      "INTERRUPTION",
      "POSITIVE_MOMENT",
    ] as const;
    await tx.callEvent.deleteMany({
      where: { callId, eventType: { in: [...auditEventTypes] } },
    });

    const startedAt = new Date(Date.now() - 500);
    await tx.callEvent.createMany({
      data: [
        { callId, aiAuditId: audit.id, eventType: "AUDIT_QUEUED", occurredAt: startedAt },
        {
          callId,
          aiAuditId: audit.id,
          eventType: "AUDIT_STARTED",
          occurredAt: new Date(startedAt.getTime() + 100),
        },
        ...validated.events.map((e, i) => ({
          callId,
          aiAuditId: audit.id,
          eventType: e.eventType,
          speaker: e.speaker,
          startTimeSeconds: e.startTimeSeconds,
          endTimeSeconds: e.endTimeSeconds,
          title: e.title,
          description: e.description,
          evidenceText: e.evidenceText,
          severity: e.severity,
          confidenceScore: e.confidenceScore,
          payload: undefined,
          occurredAt: new Date(startedAt.getTime() + 200 + i * 50),
        })),
        {
          callId,
          aiAuditId: audit.id,
          eventType: "AUDIT_COMPLETED",
          occurredAt: new Date(startedAt.getTime() + 500 + validated.events.length * 50),
        },
      ],
    });

    await tx.aiInsight.deleteMany({ where: { callId } });
    const insightRows = [
      validated.hasComplianceIssue
        ? {
            insightType: "COMPLIANCE" as const,
            severity:
              validated.complianceSeverity === "CRITICAL"
                ? ("CRITICAL" as const)
                : validated.complianceSeverity === "HIGH"
                  ? ("HIGH" as const)
                  : ("MEDIUM" as const),
            title: "Compliance issue detected",
            body: validated.improvementArea || "Review compliance adherence for this call.",
          }
        : null,
      validated.coachingRecommendation
        ? {
            insightType: "COACHING" as const,
            severity: "MEDIUM" as const,
            title: "Coaching recommendation",
            body: validated.coachingRecommendation,
          }
        : null,
      validated.customerObjections.length > 0
        ? {
            insightType: "RISK" as const,
            severity: "MEDIUM" as const,
            title: "Customer objection captured",
            body: validated.customerObjections.join("; "),
          }
        : null,
      validated.sentiment === "POSITIVE"
        ? {
            insightType: "OPPORTUNITY" as const,
            severity: "LOW" as const,
            title: "Positive customer moment",
            body: validated.summary || "Customer sentiment was positive.",
          }
        : {
            insightType: "SENTIMENT" as const,
            severity: validated.sentiment === "NEGATIVE" ? ("HIGH" as const) : ("LOW" as const),
            title: `${validated.sentiment.toLowerCase()} sentiment`,
            body: validated.summary || "Review sentiment on this call.",
          },
    ].filter((row): row is NonNullable<typeof row> => row !== null);

    if (insightRows.length > 0) {
      await tx.aiInsight.createMany({
        data: insightRows.map((row) => ({ callId, ...row })),
      });
    }

    // Update denormalised call fields the UI reads.
    const callRow = await tx.call.findUnique({
      where: { id: callId },
      select: { manualScore: true },
    });
    const aiScore = validated.scorePercent;
    await tx.call.update({
      where: { id: callId },
      data: {
        aiScore,
        sentiment: validated.sentiment,
        finalScore: callRow?.manualScore ?? aiScore,
      },
    });

    return { auditId: audit.id, auditRunNo: nextRunNo, isLatest: true } satisfies SaveAuditResult;
  });

  return result;
}
