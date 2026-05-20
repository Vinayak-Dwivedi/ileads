-- DropIndex
DROP INDEX "calls_audio_path_idx";

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "campaign_id" TEXT;

-- CreateIndex
CREATE INDEX "agents_campaign_id_idx" ON "agents"("campaign_id");

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
