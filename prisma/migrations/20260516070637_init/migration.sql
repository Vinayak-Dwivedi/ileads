-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('COMPLETED', 'MISSED', 'FAILED', 'DROPPED', 'TRANSFERRED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ScoringType" AS ENUM ('BINARY');

-- CreateEnum
CREATE TYPE "TranscriptSource" AS ENUM ('AI', 'HUMAN', 'IMPORTED');

-- CreateEnum
CREATE TYPE "SpeakerRole" AS ENUM ('AGENT', 'CUSTOMER', 'SYSTEM', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "InsightType" AS ENUM ('COACHING', 'RISK', 'COMPLIANCE', 'OPPORTUNITY', 'SENTIMENT');

-- CreateEnum
CREATE TYPE "InsightSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CallEventType" AS ENUM ('CALL_IMPORTED', 'TRANSCRIPT_READY', 'AUDIT_QUEUED', 'AUDIT_STARTED', 'AUDIT_COMPLETED', 'AUDIT_FAILED', 'MANUAL_REVIEW_STARTED', 'MANUAL_REVIEW_COMPLETED', 'NOTE_ADDED', 'OTHER');

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "industry" TEXT,
    "contact_email" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_access" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "started_on" TIMESTAMP(3),
    "ended_on" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "team_id" TEXT,
    "name" TEXT NOT NULL,
    "employee_code" TEXT,
    "email" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "hired_on" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_parameters" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "parameter_category" TEXT NOT NULL,
    "parameter_name" TEXT NOT NULL,
    "parameter_description" TEXT NOT NULL,
    "max_score" INTEGER NOT NULL,
    "ai_instruction" TEXT NOT NULL,
    "scoring_type" "ScoringType" NOT NULL DEFAULT 'BINARY',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "agent_id" TEXT,
    "team_id" TEXT,
    "external_call_id" TEXT,
    "caller_number" TEXT,
    "callee_number" TEXT,
    "direction" "CallDirection" NOT NULL DEFAULT 'UNKNOWN',
    "call_started_at" TIMESTAMP(3),
    "call_ended_at" TIMESTAMP(3),
    "duration_seconds" INTEGER,
    "recording_url" TEXT,
    "language" TEXT,
    "status" "CallStatus" NOT NULL DEFAULT 'UNKNOWN',
    "disposition" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_transcripts" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "source" "TranscriptSource" NOT NULL DEFAULT 'AI',
    "language" TEXT,
    "model_used" TEXT,
    "full_text" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_segments" (
    "id" TEXT NOT NULL,
    "transcript_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "speaker" "SpeakerRole" NOT NULL DEFAULT 'UNKNOWN',
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcript_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_audits" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "model_used" TEXT,
    "prompt_version" TEXT,
    "status" "AuditStatus" NOT NULL DEFAULT 'PENDING',
    "overall_score" DOUBLE PRECISION,
    "max_possible_score" DOUBLE PRECISION,
    "score_percent" DOUBLE PRECISION,
    "summary" TEXT,
    "sentiment" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_parameter_scores" (
    "id" TEXT NOT NULL,
    "ai_audit_id" TEXT NOT NULL,
    "parameter_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "max_score" INTEGER NOT NULL,
    "is_passed" BOOLEAN NOT NULL,
    "reasoning" TEXT,
    "evidence_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_parameter_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_events" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "event_type" "CallEventType" NOT NULL,
    "payload" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "insight_type" "InsightType" NOT NULL,
    "severity" "InsightSeverity" NOT NULL DEFAULT 'LOW',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_reviews" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "reviewer_name" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "score" DOUBLE PRECISION,
    "max_score" DOUBLE PRECISION,
    "score_percent" DOUBLE PRECISION,
    "notes" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manual_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_notes" (
    "id" TEXT NOT NULL,
    "call_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_slug_key" ON "clients"("slug");

-- CreateIndex
CREATE INDEX "client_access_client_id_idx" ON "client_access"("client_id");

-- CreateIndex
CREATE INDEX "campaigns_client_id_idx" ON "campaigns"("client_id");

-- CreateIndex
CREATE INDEX "teams_client_id_idx" ON "teams"("client_id");

-- CreateIndex
CREATE INDEX "agents_client_id_idx" ON "agents"("client_id");

-- CreateIndex
CREATE INDEX "agents_team_id_idx" ON "agents"("team_id");

-- CreateIndex
CREATE INDEX "client_parameters_client_id_idx" ON "client_parameters"("client_id");

-- CreateIndex
CREATE INDEX "client_parameters_client_id_display_order_idx" ON "client_parameters"("client_id", "display_order");

-- CreateIndex
CREATE INDEX "calls_client_id_idx" ON "calls"("client_id");

-- CreateIndex
CREATE INDEX "calls_campaign_id_idx" ON "calls"("campaign_id");

-- CreateIndex
CREATE INDEX "calls_agent_id_idx" ON "calls"("agent_id");

-- CreateIndex
CREATE INDEX "calls_team_id_idx" ON "calls"("team_id");

-- CreateIndex
CREATE INDEX "calls_call_started_at_idx" ON "calls"("call_started_at");

-- CreateIndex
CREATE UNIQUE INDEX "calls_client_id_external_call_id_key" ON "calls"("client_id", "external_call_id");

-- CreateIndex
CREATE UNIQUE INDEX "call_transcripts_call_id_key" ON "call_transcripts"("call_id");

-- CreateIndex
CREATE INDEX "transcript_segments_transcript_id_sequence_idx" ON "transcript_segments"("transcript_id", "sequence");

-- CreateIndex
CREATE INDEX "ai_audits_call_id_idx" ON "ai_audits"("call_id");

-- CreateIndex
CREATE INDEX "ai_audits_status_idx" ON "ai_audits"("status");

-- CreateIndex
CREATE INDEX "ai_parameter_scores_ai_audit_id_idx" ON "ai_parameter_scores"("ai_audit_id");

-- CreateIndex
CREATE INDEX "ai_parameter_scores_parameter_id_idx" ON "ai_parameter_scores"("parameter_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_parameter_scores_ai_audit_id_parameter_id_key" ON "ai_parameter_scores"("ai_audit_id", "parameter_id");

-- CreateIndex
CREATE INDEX "call_events_call_id_occurred_at_idx" ON "call_events"("call_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ai_insights_call_id_idx" ON "ai_insights"("call_id");

-- CreateIndex
CREATE INDEX "manual_reviews_call_id_idx" ON "manual_reviews"("call_id");

-- CreateIndex
CREATE INDEX "manual_reviews_status_idx" ON "manual_reviews"("status");

-- CreateIndex
CREATE INDEX "call_notes_call_id_idx" ON "call_notes"("call_id");

-- AddForeignKey
ALTER TABLE "client_access" ADD CONSTRAINT "client_access_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_parameters" ADD CONSTRAINT "client_parameters_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_transcripts" ADD CONSTRAINT "call_transcripts_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_transcript_id_fkey" FOREIGN KEY ("transcript_id") REFERENCES "call_transcripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_audits" ADD CONSTRAINT "ai_audits_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_parameter_scores" ADD CONSTRAINT "ai_parameter_scores_ai_audit_id_fkey" FOREIGN KEY ("ai_audit_id") REFERENCES "ai_audits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_parameter_scores" ADD CONSTRAINT "ai_parameter_scores_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "client_parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_reviews" ADD CONSTRAINT "manual_reviews_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_notes" ADD CONSTRAINT "call_notes_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
