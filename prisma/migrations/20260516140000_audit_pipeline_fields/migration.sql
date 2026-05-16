-- Audit pipeline: track per-run AI audits, store the prompt + raw response
-- for debugging, and capture richer per-parameter / per-event signals.

-- ---------- New enums ----------
CREATE TYPE "EventSpeaker" AS ENUM ('AGENT', 'CUSTOMER', 'BOTH', 'UNKNOWN');
CREATE TYPE "EventSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "ParameterResult" AS ENUM ('PASS', 'FAIL', 'NOT_FOUND');

-- Extend CallEventType with audit-derived event categories.
ALTER TYPE "CallEventType" ADD VALUE 'COMPLIANCE_ISSUE';
ALTER TYPE "CallEventType" ADD VALUE 'CUSTOMER_OBJECTION';
ALTER TYPE "CallEventType" ADD VALUE 'ESCALATION_RISK';
ALTER TYPE "CallEventType" ADD VALUE 'EMPATHY_GAP';
ALTER TYPE "CallEventType" ADD VALUE 'SCRIPT_DEVIATION';
ALTER TYPE "CallEventType" ADD VALUE 'POSSIBLE_RAISED_TONE';
ALTER TYPE "CallEventType" ADD VALUE 'RUDE_LANGUAGE';
ALTER TYPE "CallEventType" ADD VALUE 'INTERRUPTION';
ALTER TYPE "CallEventType" ADD VALUE 'POSITIVE_MOMENT';

-- ---------- ai_audits ----------
ALTER TABLE "ai_audits"
  ADD COLUMN "audit_mode"              TEXT,
  ADD COLUMN "audit_run_no"            INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "is_latest"               BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "agent_tone"              TEXT,
  ADD COLUMN "customer_emotion"        TEXT,
  ADD COLUMN "has_compliance_issue"    BOOLEAN,
  ADD COLUMN "compliance_severity"     TEXT,
  ADD COLUMN "improvement_area"        TEXT,
  ADD COLUMN "coaching_recommendation" TEXT,
  ADD COLUMN "next_best_action"        TEXT,
  ADD COLUMN "agent_strengths"         JSONB,
  ADD COLUMN "agent_weaknesses"        JSONB,
  ADD COLUMN "customer_objections"     JSONB,
  ADD COLUMN "compliance_issues"       JSONB,
  ADD COLUMN "prompt_text"             TEXT,
  ADD COLUMN "raw_ai_response"         JSONB,
  ADD COLUMN "validated_response"      JSONB;

CREATE INDEX "ai_audits_call_id_is_latest_idx" ON "ai_audits" ("call_id", "is_latest");

-- ---------- ai_parameter_scores ----------
ALTER TABLE "ai_parameter_scores"
  ADD COLUMN "result"                 "ParameterResult" NOT NULL DEFAULT 'NOT_FOUND',
  ADD COLUMN "evidence_start_seconds" DOUBLE PRECISION,
  ADD COLUMN "evidence_end_seconds"   DOUBLE PRECISION,
  ADD COLUMN "confidence_score"       DOUBLE PRECISION;

-- Backfill: existing rows had isPassed -> infer PASS/FAIL.
UPDATE "ai_parameter_scores"
SET "result" = CASE WHEN "is_passed" THEN 'PASS'::"ParameterResult" ELSE 'FAIL'::"ParameterResult" END;

-- ---------- call_events ----------
ALTER TABLE "call_events"
  ADD COLUMN "ai_audit_id"        TEXT,
  ADD COLUMN "speaker"            "EventSpeaker",
  ADD COLUMN "start_time_seconds" DOUBLE PRECISION,
  ADD COLUMN "end_time_seconds"   DOUBLE PRECISION,
  ADD COLUMN "title"              TEXT,
  ADD COLUMN "description"        TEXT,
  ADD COLUMN "evidence_text"      TEXT,
  ADD COLUMN "severity"           "EventSeverity",
  ADD COLUMN "confidence_score"   DOUBLE PRECISION;

CREATE INDEX "call_events_ai_audit_id_idx" ON "call_events" ("ai_audit_id");
