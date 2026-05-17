-- Add processing-lock columns on calls.
ALTER TABLE "calls"
  ADD COLUMN "processing_status"     TEXT,
  ADD COLUMN "processing_started_at" TIMESTAMP(3),
  ADD COLUMN "processing_error"      TEXT;

-- New per-client editable audit prompt template.
CREATE TABLE "client_audit_prompts" (
    "id"          TEXT NOT NULL,
    "client_id"   TEXT NOT NULL,
    "prompt_name" TEXT NOT NULL DEFAULT 'Default audit prompt',
    "prompt_text" TEXT NOT NULL,
    "is_active"   BOOLEAN NOT NULL DEFAULT true,
    "version_no"  INTEGER NOT NULL DEFAULT 1,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_audit_prompts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_audit_prompts_client_id_idx"
    ON "client_audit_prompts"("client_id");

CREATE INDEX "client_audit_prompts_client_id_is_active_idx"
    ON "client_audit_prompts"("client_id", "is_active");

ALTER TABLE "client_audit_prompts"
    ADD CONSTRAINT "client_audit_prompts_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
