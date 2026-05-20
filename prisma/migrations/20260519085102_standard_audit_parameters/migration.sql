-- Standard audit parameter (KPI) table: 10 standard buckets each client's
-- sub-parameters roll up into.
CREATE TABLE "standard_audit_parameters" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "standard_audit_parameters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "standard_audit_parameters_name_key" ON "standard_audit_parameters"("name");

-- Add nullable FK on client_parameters that points at the standard parameter
-- bucket. Nullable so historical sub-parameters can be backfilled by the
-- import script and unmapped rows remain valid.
ALTER TABLE "client_parameters"
    ADD COLUMN "standard_parameter_id" TEXT;

ALTER TABLE "client_parameters"
    ADD CONSTRAINT "client_parameters_standard_parameter_id_fkey"
    FOREIGN KEY ("standard_parameter_id")
    REFERENCES "standard_audit_parameters"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "client_parameters_standard_parameter_id_idx" ON "client_parameters"("standard_parameter_id");
