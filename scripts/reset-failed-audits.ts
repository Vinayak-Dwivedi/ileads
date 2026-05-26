import "dotenv/config";
import { prisma } from "../src/lib/db";

async function main() {
  const res = await prisma.call.updateMany({
    where: {
      processingStatus: "failed",
      processingError: { contains: "AUDIT" },
    },
    data: {
      processingStatus: "uploaded",
      processingStartedAt: null,
      processingError: null,
    },
  });
  console.log(`Reset ${res.count} failed audit calls back to "uploaded".`);
  await prisma.$disconnect();
}

main();
