/**
 * Idempotent: seed the final 10 standard audit parameters (parent KPI
 * buckets) and map every active Beetel sub-parameter to one of them.
 *
 * Mapping is done by exact (case-insensitive) sub-parameter name.
 *
 * Run:  npm run import:standard-parameters
 */

import { prisma } from "../src/lib/db";

const TARGET_CLIENT_ID = "cmp8awxnz0000l4n9g9wzs8vy"; // Beetel

interface StandardParam {
  name: string;
  description: string;
  sortOrder: number;
}

// Final list — order is the display order in KPI cards and dropdowns.
const STANDARD_PARAMS: StandardParam[] = [
  {
    name: "Opening / Greeting",
    description: "Prompt, branded, professional call opening within the first few seconds.",
    sortOrder: 10,
  },
  {
    name: "Customer Verification",
    description: "Addressing the customer by name and confirming identity / context.",
    sortOrder: 20,
  },
  {
    name: "Call Purpose Identification",
    description: "Establishing the reason for the call and confirming the customer's language/channel preferences.",
    sortOrder: 30,
  },
  {
    name: "Communication Skills",
    description: "Energy, attentiveness, rate of speech, confidence, fluency, sentence formation.",
    sortOrder: 40,
  },
  {
    name: "Listening & Probing",
    description: "Asking the right questions and probing to understand the customer's query/concern.",
    sortOrder: 50,
  },
  {
    name: "Empathy & Courtesy",
    description: "Acknowledging the concern, apologising / sympathising as required, varied courteous tone.",
    sortOrder: 60,
  },
  {
    name: "Product / Process Knowledge",
    description: "Correct handling of the product/process and the conversion/pickup pitch.",
    sortOrder: 70,
  },
  {
    name: "Resolution / Assistance Quality",
    description: "Hold procedure, interruptions, dead-air control during resolution.",
    sortOrder: 80,
  },
  {
    name: "Compliance",
    description: "Correct disposition tagging, accurate information, no false commitments.",
    sortOrder: 90,
  },
  {
    name: "Closing & Documentation",
    description: "Standard closing script and offer of further assistance.",
    sortOrder: 100,
  },
];

const FINAL_NAMES = new Set(STANDARD_PARAMS.map((p) => p.name));

// Map Beetel sub-parameter (normalized name) -> final standard parameter name.
const SUB_TO_STANDARD: Record<string, string> = {
  // Opening / Greeting
  "did associate open the call with in 3 secs?": "Opening / Greeting",
  "did associate greet the customer appropriately?": "Opening / Greeting",
  "did associate do branding?": "Opening / Greeting",

  // Listening & Probing
  "did associate ask for customer query/concern/relevant questions asked?":
    "Listening & Probing",
  "did associate probe well to understand customer's query / concern?":
    "Listening & Probing",

  // Empathy & Courtesy
  "did associate acknowledge customer query / concern?": "Empathy & Courtesy",
  "did associate apologized / sympathised (if required)": "Empathy & Courtesy",
  "varied tone and courteous": "Empathy & Courtesy",

  // Customer Verification
  "did associate address the customer by his / her name?": "Customer Verification",

  // Communication Skills
  "was associate enthusiastic and energetic throughout the call?": "Communication Skills",
  "was associate attentive?": "Communication Skills",
  "did associate control rate of speech?": "Communication Skills",
  "was associate fluent throughout the call?": "Communication Skills",
  "was sentence formation / pronunciation up to the mark?": "Communication Skills",
  "was associate confident on call?": "Communication Skills",

  // Call Purpose Identification
  "did associate switch language as per customer language?": "Call Purpose Identification",

  // Resolution / Assistance Quality
  "did not interrupt and waited for customer to complete first?":
    "Resolution / Assistance Quality",
  "was the hold procedure followed?": "Resolution / Assistance Quality",
  "dead air (should not exceed 10 sec)": "Resolution / Assistance Quality",

  // Product / Process Knowledge
  "convincing for device pick-up/ fake leads generate": "Product / Process Knowledge",

  // Compliance
  "tag the customer call correctly": "Compliance",
  "did associate provided correct information to customer and did not make false commitment?":
    "Compliance",

  // Closing & Documentation
  "did associate ask for further assistance?": "Closing & Documentation",
  "did associate follow standard closing script?": "Closing & Documentation",
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

async function main() {
  if (STANDARD_PARAMS.length !== 10) {
    throw new Error(`Expected 10 standard parameters, got ${STANDARD_PARAMS.length}.`);
  }

  // --- 1. Upsert the final 10 standard parameters --------------------------
  for (const sp of STANDARD_PARAMS) {
    await prisma.standardAuditParameter.upsert({
      where: { name: sp.name },
      update: {
        description: sp.description,
        sortOrder: sp.sortOrder,
        isActive: true,
      },
      create: {
        name: sp.name,
        description: sp.description,
        sortOrder: sp.sortOrder,
        isActive: true,
      },
    });
  }

  // --- 2. Detach mappings from any non-final standards, then deactivate ----
  // (Hard delete only if no client_parameters still reference them.)
  const allStandards = await prisma.standardAuditParameter.findMany({
    select: { id: true, name: true },
  });
  const obsolete = allStandards.filter((s) => !FINAL_NAMES.has(s.name));
  for (const o of obsolete) {
    await prisma.clientParameter.updateMany({
      where: { standardParameterId: o.id },
      data: { standardParameterId: null },
    });
    const stillRefs = await prisma.clientParameter.count({
      where: { standardParameterId: o.id },
    });
    if (stillRefs === 0) {
      await prisma.standardAuditParameter.delete({ where: { id: o.id } });
    } else {
      await prisma.standardAuditParameter.update({
        where: { id: o.id },
        data: { isActive: false },
      });
    }
  }

  const standard = await prisma.standardAuditParameter.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });
  const byName = new Map(standard.map((s) => [s.name, s.id]));
  console.log(`Active standard parameters: ${standard.length}`);

  // --- 3. Map every Beetel sub-parameter (active and inactive) -------------
  const subs = await prisma.clientParameter.findMany({
    where: { clientId: TARGET_CLIENT_ID },
    select: { id: true, parameterName: true, isActive: true, standardParameterId: true },
    orderBy: { displayOrder: "asc" },
  });

  let mapped = 0;
  let alreadyCorrect = 0;
  const unmappedActive: string[] = [];

  for (const sub of subs) {
    const targetName = SUB_TO_STANDARD[normalize(sub.parameterName)];
    if (!targetName) {
      if (sub.isActive) unmappedActive.push(sub.parameterName);
      continue;
    }
    const targetId = byName.get(targetName);
    if (!targetId) {
      throw new Error(`Standard parameter "${targetName}" missing after upsert.`);
    }
    if (sub.standardParameterId === targetId) {
      alreadyCorrect += 1;
      continue;
    }
    await prisma.clientParameter.update({
      where: { id: sub.id },
      data: { standardParameterId: targetId },
    });
    mapped += 1;
  }

  // --- 4. Summary ----------------------------------------------------------
  const activeAfter = await prisma.clientParameter.findMany({
    where: { clientId: TARGET_CLIENT_ID, isActive: true },
    select: { id: true, parameterName: true, standardParameterId: true },
  });
  const stillUnmapped = activeAfter
    .filter((p) => !p.standardParameterId)
    .map((p) => p.parameterName);

  console.log(
    `Mapped: updated=${mapped} alreadyCorrect=${alreadyCorrect} subsTotal=${subs.length}`,
  );
  console.log(`Active sub-parameters: ${activeAfter.length}`);
  console.log("Final standard list:");
  for (const s of standard) console.log(`  - ${s.name}`);

  if (stillUnmapped.length > 0) {
    console.warn(`Unmapped ACTIVE parameters (${stillUnmapped.length}):`);
    for (const name of stillUnmapped) console.warn(`  - ${name}`);
  }
  if (unmappedActive.length > 0) {
    console.warn(`Active subs without a mapping rule (${unmappedActive.length}):`);
    for (const name of unmappedActive) console.warn(`  - ${name}`);
  }

  if (stillUnmapped.length > 0) {
    throw new Error(
      `Refusing to exit OK: ${stillUnmapped.length} active sub-parameter(s) are still unmapped.`,
    );
  }
  console.log("OK: 10 standard parameters seeded and all active sub-parameters mapped.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
