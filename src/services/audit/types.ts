// Shared types for the audit pipeline. Loose JSON-shaped types are kept on the
// "Raw" side (what we'd get from an LLM); strict types live on the "Validated"
// side (the safe object we save to the database).

import type { ClientParameter, EventSeverity, EventSpeaker, ParameterResult } from "@prisma/client";

export type AuditMode = "mock" | "live";

export interface AuditCallContext {
  client: { id: string; name: string };
  call: {
    id: string;
    externalCallId: string | null;
    direction: string;
    durationSeconds: number | null;
    language: string | null;
    disposition: string | null;
    callerNumber: string | null;
    calleeNumber: string | null;
    customerName: string | null;
    callStartedAt: Date | null;
    callEndedAt: Date | null;
    campaignName: string | null;
    agentName: string | null;
    teamName: string | null;
  };
  parameters: ClientParameter[];
  transcript: {
    fullText: string;
    speakerLabelNote?: string | null;
    segments: Array<{
      sequence: number;
      speaker: string;
      startMs: number;
      endMs: number;
      text: string;
      channel?: string | null;
      speakerSource?: string | null;
    }>;
  };
}

// ---------------------------- Raw (LLM) shape ----------------------------

export interface RawAuditParameterScore {
  parameter_id?: unknown;
  parameter_name?: unknown;
  max_score?: unknown;
  result?: unknown;
  awarded_score?: unknown;
  reason?: unknown;
  evidence_text?: unknown;
  evidence_start_time_seconds?: unknown;
  evidence_end_time_seconds?: unknown;
  confidence_score?: unknown;
}

export interface RawAuditEvent {
  event_type?: unknown;
  speaker?: unknown;
  start_time_seconds?: unknown;
  end_time_seconds?: unknown;
  event_title?: unknown;
  event_description?: unknown;
  evidence_text?: unknown;
  severity?: unknown;
  confidence_score?: unknown;
}

export interface RawAuditResponse {
  overall_score?: unknown;
  max_possible_score?: unknown;
  score_percentage?: unknown;
  sentiment?: unknown;
  agent_tone?: unknown;
  customer_emotion?: unknown;
  has_compliance_issue?: unknown;
  compliance_severity?: unknown;
  ai_summary?: unknown;
  improvement_area?: unknown;
  coaching_recommendation?: unknown;
  parameter_scores?: unknown;
  events?: unknown;
  agent_strengths?: unknown;
  agent_weaknesses?: unknown;
  customer_objections?: unknown;
  compliance_issues?: unknown;
  next_best_action?: unknown;
}

// ------------------------- Validated (DB-safe) shape -------------------------

export type Sentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "MIXED";
export type ComplianceSeverity = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ValidatedParameterScore {
  parameterId: string;
  parameterName: string;
  maxScore: number;
  result: ParameterResult;
  awardedScore: number;
  reason: string | null;
  evidenceText: string | null;
  evidenceStartSeconds: number | null;
  evidenceEndSeconds: number | null;
  confidenceScore: number | null;
}

export interface ValidatedEvent {
  eventType: import("@prisma/client").CallEventType;
  speaker: EventSpeaker;
  startTimeSeconds: number | null;
  endTimeSeconds: number | null;
  title: string;
  description: string;
  evidenceText: string | null;
  severity: EventSeverity;
  confidenceScore: number | null;
}

export interface ValidatedAuditResponse {
  overallScore: number;
  maxPossibleScore: number;
  scorePercent: number;
  sentiment: Sentiment;
  agentTone: string;
  customerEmotion: string;
  hasComplianceIssue: boolean;
  complianceSeverity: ComplianceSeverity;
  summary: string;
  improvementArea: string;
  coachingRecommendation: string;
  nextBestAction: string;
  parameterScores: ValidatedParameterScore[];
  events: ValidatedEvent[];
  agentStrengths: string[];
  agentWeaknesses: string[];
  customerObjections: string[];
  complianceIssues: string[];
  warnings: string[];
}
