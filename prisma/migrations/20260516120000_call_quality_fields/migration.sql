-- Add denormalised quality columns to calls so the UI can read scores,
-- sentiment, manual disposition, and the AHT/FRT metrics directly without
-- joining the audit / manual review tables on every render.

ALTER TABLE "calls"
  ADD COLUMN "customer_name"           TEXT,
  ADD COLUMN "first_response_seconds"  INTEGER,
  ADD COLUMN "average_handle_seconds"  INTEGER,
  ADD COLUMN "sentiment"               TEXT,
  ADD COLUMN "ai_score"                DOUBLE PRECISION,
  ADD COLUMN "manual_score"            DOUBLE PRECISION,
  ADD COLUMN "final_score"             DOUBLE PRECISION,
  ADD COLUMN "manual_disposition"      TEXT;
