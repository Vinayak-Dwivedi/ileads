import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const client = await prisma.client.findFirst({
    where: { slug: "beetel" },
  });
  if (!client) {
    console.error("Beetel client not found");
    return;
  }
  const params = await prisma.clientParameter.findMany({
    where: { clientId: client.id },
    include: { standardParameter: true },
    orderBy: { displayOrder: "asc" },
  });
  console.log(`Found ${params.length} parameters for Beetel:`);
  let allMapped = true;
  for (const p of params) {
    const standardName = p.standardParameter?.name ?? "NULL";
    console.log(`- [${p.parameterCategory}] "${p.parameterName}" -> Standard: "${standardName}"`);
    if (!p.standardParameterId) {
      allMapped = false;
    }
  }
  console.log("\nStatus: " + (allMapped ? "All mapped successfully!" : "Some parameters are missing standard links!"));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
