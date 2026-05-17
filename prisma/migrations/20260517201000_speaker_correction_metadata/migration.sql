ALTER TABLE "call_transcripts"
  ADD COLUMN "speaker_labels_corrected" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "speaker_correction_note" TEXT,
  ADD COLUMN "speaker_corrected_at" TIMESTAMP(3);
