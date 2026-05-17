CREATE TABLE "transcript_segment_corrections" (
  "id" TEXT NOT NULL,
  "transcript_segment_id" TEXT NOT NULL,
  "call_id" TEXT NOT NULL,
  "call_transcript_id" TEXT NOT NULL,
  "old_speaker" "SpeakerRole" NOT NULL,
  "new_speaker" "SpeakerRole" NOT NULL,
  "old_speaker_source" TEXT,
  "new_speaker_source" TEXT NOT NULL,
  "segment_text" TEXT NOT NULL,
  "start_time_seconds" DOUBLE PRECISION NOT NULL,
  "end_time_seconds" DOUBLE PRECISION NOT NULL,
  "raw_speaker_id" TEXT,
  "corrected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "corrected_by" TEXT,
  "correction_reason" TEXT,

  CONSTRAINT "transcript_segment_corrections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "transcript_segment_corrections_transcript_segment_id_idx"
  ON "transcript_segment_corrections"("transcript_segment_id");

CREATE INDEX "transcript_segment_corrections_call_id_corrected_at_idx"
  ON "transcript_segment_corrections"("call_id", "corrected_at");

CREATE INDEX "transcript_segment_corrections_call_transcript_id_idx"
  ON "transcript_segment_corrections"("call_transcript_id");

ALTER TABLE "transcript_segment_corrections"
  ADD CONSTRAINT "transcript_segment_corrections_transcript_segment_id_fkey"
  FOREIGN KEY ("transcript_segment_id") REFERENCES "transcript_segments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "transcript_segment_corrections"
  ADD CONSTRAINT "transcript_segment_corrections_call_id_fkey"
  FOREIGN KEY ("call_id") REFERENCES "calls"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "transcript_segment_corrections"
  ADD CONSTRAINT "transcript_segment_corrections_call_transcript_id_fkey"
  FOREIGN KEY ("call_transcript_id") REFERENCES "call_transcripts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
