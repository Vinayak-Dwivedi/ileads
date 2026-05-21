-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "QuotaKind" AS ENUM ('AUDITS_PER_DAY', 'CALLS_PER_DAY', 'STT_MINUTES_PER_DAY');

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" JSONB NOT NULL,
    "secret" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "response_status" INTEGER,
    "response_body_excerpt" TEXT,
    "error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_quotas" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "kind" "QuotaKind" NOT NULL,
    "daily_limit" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_usage" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "kind" "QuotaKind" NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "cost" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quota_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhooks_client_id_idx" ON "webhooks"("client_id");

-- CreateIndex
CREATE INDEX "webhooks_client_id_is_active_idx" ON "webhooks"("client_id", "is_active");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhook_id_created_at_idx" ON "webhook_deliveries"("webhook_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "client_quotas_client_id_kind_key" ON "client_quotas"("client_id", "kind");

-- CreateIndex
CREATE INDEX "quota_usage_client_id_day_idx" ON "quota_usage"("client_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "quota_usage_client_id_kind_day_key" ON "quota_usage"("client_id", "kind", "day");

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_quotas" ADD CONSTRAINT "client_quotas_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_usage" ADD CONSTRAINT "quota_usage_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
