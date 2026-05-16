-- Store local audio upload metadata without exposing filesystem paths publicly.
ALTER TABLE "calls"
  ADD COLUMN "original_file_name" TEXT,
  ADD COLUMN "stored_file_name"   TEXT,
  ADD COLUMN "audio_path"         TEXT,
  ADD COLUMN "mime_type"          TEXT,
  ADD COLUMN "file_size_bytes"    BIGINT;

CREATE INDEX "calls_audio_path_idx" ON "calls" ("audio_path");
