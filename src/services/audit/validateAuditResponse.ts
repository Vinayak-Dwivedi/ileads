import type {
  CallEventType,
} from "@prisma/client";
import type {
  AuditCallContext,
  ComplianceSeverity,
  RawAuditEvent,
  RawAuditParameterScore,
  RawAuditResponse,
  Sentiment,
  ValidatedAuditResponse,
  ValidatedEvent,
  ValidatedParameterScore,
} from "./types";

const KNOWN_EVENT_TYPES: ReadonlySet<CallEventType> = new Set([
  "CALL_IMPORTED",
  "TRANSCRIPT_READY",
  "AUDIT_QUEUED",
  "AUDIT_STARTED",
  "AUDIT_COMPLETED",
  "AUDIT_FAILED",
  "MANUAL_REVIEW_STARTED",
  "MANUAL_REVIEW_COMPLETED",
  "NOTE_ADDED",
  "COMPLIANCE_ISSUE",
  "CUSTOMER_OBJECTION",
  "ESCALATION_RISK",
  "EMPATHY_GAP",
  "SCRIPT_DEVIATION",
  "POSSIBLE_RAISED_TONE",
  "RUDE_LANGUAGE",
  "INTERRUPTION",
  "POSITIVE_MOMENT",
  "OTHER",
]);

const EVENT_TYPE_ALIASES: Record<string, CallEventType> = {
  compliance_issue: "COMPLIANCE_ISSUE",
  customer_objection: "CUSTOMER_OBJECTION",
  escalation_risk: "ESCALATION_RISK",
  empathy_gap: "EMPATHY_GAP",
  script_deviation: "SCRIPT_DEVIATION",
  possible_raised_tone: "POSSIBLE_RAISED_TONE",
  tone_issue: "POSSIBLE_RAISED_TONE",
  raised_tone: "POSSIBLE_RAISED_TONE",
  rude_language: "RUDE_LANGUAGE",
  interruption: "INTERRUPTION",
  positive_moment: "POSITIVE_MOMENT",
  positive: "POSITIVE_MOMENT",
};

function asStr(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return fallback;
}

function asTrimmedStr(v: unknown, fallback = ""): string {
  return asStr(v, fallback).trim();
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asTimestamp(v: unknown): number | null {
  const n = asNumber(v);
  if (n == null) return null;
  if (n < 0) return null;
  if (!Number.isFinite(n)) return null;
  return n;
}

function asConfidence(v: unknown): number | null {
  const n = asNumber(v);
  if (n == null) return null;
  // Accept 0..1 OR 0..100; collapse to 0..1.
  if (n > 1 && n <= 100) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

function normalizeSentiment(v: unknown): Sentiment {
  const s = asTrimmedStr(v).toLowerCase();
  if (s === "positive" || s === "negative" || s === "neutral" || s === "mixed")
    return s.toUpperCase() as Sentiment;
  return "NEUTRAL";
}

function normalizeComplianceSeverity(v: unknown): ComplianceSeverity {
  const s = asTrimmedStr(v).toLowerCase();
  if (s === "none" || s === "low" || s === "medium" || s === "high" || s === "critical")
    return s.toUpperCase() as ComplianceSeverity;
  return "NONE";
}

function normalizeEventSeverity(v: unknown): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  const s = asTrimmedStr(v).toLowerCase();
  if (s === "critical") return "CRITICAL";
  if (s === "high") return "HIGH";
  if (s === "medium" || s === "med") return "MEDIUM";
  return "LOW";
}

function normalizeSpeaker(v: unknown): ValidatedEvent["speaker"] {
  const s = asTrimmedStr(v).toLowerCase();
  if (s === "agent") return "AGENT";
  if (s === "customer") return "CUSTOMER";
  if (s === "both") return "BOTH";
  return "UNKNOWN";
}

function normalizeEventType(v: unknown): CallEventType {
  const raw = asTrimmedStr(v);
  if (!raw) return "OTHER";
  const upper = raw.toUpperCase().replace(/[\s\-]+/g, "_");
  if (KNOWN_EVENT_TYPES.has(upper as CallEventType)) return upper as CallEventType;
  const lower = raw.toLowerCase().replace(/[\s\-]+/g, "_");
  if (lower in EVENT_TYPE_ALIASES) return EVENT_TYPE_ALIASES[lower];
  return "OTHER";
}

function normalizeStrList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => asTrimmedStr(x))
    .filter((s) => s.length > 0)
    .slice(0, 20);
}

/**
 * Take whatever the LLM (or mock) returned and produce a safe object that we
 * can trust before hitting the database.
 *
 * The validator enforces binary scoring, fills in any missing parameter,
 * ignores foreign parameter_ids, recomputes overall totals, and clamps
 * confidence + timestamps to safe ranges.
 */
export function validateAuditResponse(
  raw: RawAuditResponse,
  ctx: AuditCallContext,
): ValidatedAuditResponse {
  const warnings: string[] = [];
  const activeById = new Map(ctx.parameters.map((p) => [p.id, p]));
  const activeByName = new Map(
    ctx.parameters.map((p) => [p.parameterName.toLowerCase().trim(), p]),
  );

  // ---- parameter scores ----
  const rawParameterScores = Array.isArray(raw.parameter_scores)
    ? (raw.parameter_scores as RawAuditParameterScore[])
    : [];

  const validatedById = new Map<string, ValidatedParameterScore>();

  for (const rps of rawParameterScores) {
    let parameter = null as typeof ctx.parameters[number] | null;
    const idRaw = asTrimmedStr(rps.parameter_id);
    if (idRaw && activeById.has(idRaw)) parameter = activeById.get(idRaw)!;
    if (!parameter) {
      const nameRaw = asTrimmedStr(rps.parameter_name).toLowerCase();
      if (nameRaw && activeByName.has(nameRaw)) parameter = activeByName.get(nameRaw)!;
    }
    if (!parameter) {
      warnings.push(
        `Ignored unknown parameter_id "${idRaw}" / name "${asTrimmedStr(rps.parameter_name)}".`,
      );
      continue;
    }
    if (validatedById.has(parameter.id)) {
      warnings.push(`Duplicate score for parameter "${parameter.parameterName}" — using first.`);
      continue;
    }

    const resultStr = asTrimmedStr(rps.result).toLowerCase();
    let result: ValidatedParameterScore["result"];
    if (resultStr === "pass") result = "PASS";
    else if (resultStr === "fail") result = "FAIL";
    else result = "NOT_FOUND";

    const awardedRaw = asNumber(rps.awarded_score);
    const expected = result === "PASS" ? parameter.maxScore : 0;
    let awarded = awardedRaw ?? expected;
    if (awarded !== expected) {
      warnings.push(
        `Forced ${parameter.parameterName} awarded_score ${awarded} -> ${expected} (binary scoring).`,
      );
      awarded = expected;
    }

    validatedById.set(parameter.id, {
      parameterId: parameter.id,
      parameterName: parameter.parameterName,
      maxScore: parameter.maxScore,
      result,
      awardedScore: awarded,
      reason: asTrimmedStr(rps.reason) || null,
      evidenceText: asTrimmedStr(rps.evidence_text) || null,
      evidenceStartSeconds: asTimestamp(rps.evidence_start_time_seconds),
      evidenceEndSeconds: asTimestamp(rps.evidence_end_time_seconds),
      confidenceScore: asConfidence(rps.confidence_score),
    });
  }

  // Back-fill any parameters the model missed.
  for (const p of ctx.parameters) {
    if (validatedById.has(p.id)) continue;
    warnings.push(`Parameter "${p.parameterName}" missing from response — marked not_found.`);
    validatedById.set(p.id, {
      parameterId: p.id,
      parameterName: p.parameterName,
      maxScore: p.maxScore,
      result: "NOT_FOUND",
      awardedScore: 0,
      reason: null,
      evidenceText: null,
      evidenceStartSeconds: null,
      evidenceEndSeconds: null,
      confidenceScore: null,
    });
  }

  const parameterScores = ctx.parameters.map((p) => validatedById.get(p.id)!);

  // ---- recompute totals from the validated list ----
  const maxPossibleScore = parameterScores.reduce((s, p) => s + p.maxScore, 0);
  const overallScore = parameterScores.reduce((s, p) => s + p.awardedScore, 0);
  const scorePercent = maxPossibleScore === 0 ? 0 : (overallScore / maxPossibleScore) * 100;

  // ---- events ----
  const rawEvents = Array.isArray(raw.events) ? (raw.events as RawAuditEvent[]) : [];
  const events: ValidatedEvent[] = rawEvents
    .map((re) => {
      const eventType = normalizeEventType(re.event_type);
      const start = asTimestamp(re.start_time_seconds);
      const end = asTimestamp(re.end_time_seconds);
      const title = asTrimmedStr(re.event_title);
      const description = asTrimmedStr(re.event_description);
      if (!title && !description) return null; // skip empty event
      return {
        eventType,
        speaker: normalizeSpeaker(re.speaker),
        startTimeSeconds: start,
        endTimeSeconds: end,
        title: title || description.slice(0, 60),
        description: description || title,
        evidenceText: asTrimmedStr(re.evidence_text) || null,
        severity: normalizeEventSeverity(re.severity),
        confidenceScore: asConfidence(re.confidence_score),
      } satisfies ValidatedEvent;
    })
    .filter((e): e is ValidatedEvent => e !== null);

  // ---- top-level fields ----
  const sentiment = normalizeSentiment(raw.sentiment);
  const complianceSeverity = normalizeComplianceSeverity(raw.compliance_severity);
  const hasComplianceIssue =
    typeof raw.has_compliance_issue === "boolean"
      ? raw.has_compliance_issue
      : complianceSeverity !== "NONE";

  return {
    overallScore,
    maxPossibleScore,
    scorePercent,
    sentiment,
    agentTone: asTrimmedStr(raw.agent_tone, "unclear"),
    customerEmotion: asTrimmedStr(raw.customer_emotion, "unclear"),
    hasComplianceIssue,
    complianceSeverity,
    summary: asTrimmedStr(raw.ai_summary, ""),
    improvementArea: asTrimmedStr(raw.improvement_area, ""),
    coachingRecommendation: asTrimmedStr(raw.coaching_recommendation, ""),
    nextBestAction: asTrimmedStr(raw.next_best_action, ""),
    parameterScores,
    events,
    agentStrengths: normalizeStrList(raw.agent_strengths),
    agentWeaknesses: normalizeStrList(raw.agent_weaknesses),
    customerObjections: normalizeStrList(raw.customer_objections),
    complianceIssues: normalizeStrList(raw.compliance_issues),
    warnings,
  };
}
