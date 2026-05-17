ALTER TABLE "call_transcripts"
  ADD COLUMN "fallback_used" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "fallback_reason" TEXT,
  ADD COLUMN "attempted_models" JSONB,
  ADD COLUMN "quality_flags" JSONB;

ALTER TABLE "transcript_segments"
  ADD COLUMN "channel" TEXT,
  ADD COLUMN "speaker_source" TEXT;
