/**
 * Idempotent migration: rename the demo client to "Beetel" and replace its
 * active parameter set with the 24-row Beetel BPO evaluation sheet (total 100).
 *
 * Strategy:
 *  - Match existing parameters by normalized (category, name).
 *  - Update matched rows in-place (description, score, ai instruction, active=true).
 *  - Create missing rows.
 *  - Deactivate (NOT delete) any existing parameter not in the Beetel list so
 *    audit history is preserved.
 *  - Deactivate any custom audit prompt that looks stale (references "Acme")
 *    so the generated default rebuilds from the new parameter set.
 *
 * Run:  npm run import:beetel-parameters
 */

import { prisma } from "../src/lib/db";

const TARGET_CLIENT_ID = "cmp8awxnz0000l4n9g9wzs8vy";
const TARGET_NAME = "Beetel";
const TARGET_SLUG = "beetel";

const BINARY_RULE =
  "Binary scoring: mark pass only if behavior is clearly fulfilled in the transcript; " +
  "if evidence is missing, mark not_found; if not fulfilled, mark fail. " +
  "pass = full score; fail or not_found = 0.";

interface BeetelParam {
  category: string;
  name: string;
  maxScore: number;
  description: string;
}

const BEETEL_PARAMS: BeetelParam[] = [
  {
    category: "Opening",
    name: "Did associate open the call with in 3 secs?",
    maxScore: 3,
    description: "Opening should be prompt within 3 seconds. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Opening",
    name: "Did associate greet the customer appropriately?",
    maxScore: 3,
    description:
      "In greeting, agent should not use hello, hi, or casual words. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Opening",
    name: "Did associate do branding?",
    maxScore: 3,
    description: "Proper and clear usage of brand name on call. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Did associate ask for customer query/concern/relevant questions asked?",
    maxScore: 4,
    description:
      "Appropriate probing should be done on call as per call scenario. If agent did not probe to clarify customer concern or give appropriate answer, mark down. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Did associate acknowledge customer query / concern?",
    maxScore: 5,
    description:
      "Provide frequent indicators or acknowledgement that the agent is listening to the customer. Customer should feel that their voice is being listened to and captured properly. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Did associate apologized / sympathised (if required)",
    maxScore: 5,
    description:
      "Approach customer with compassion and apologies when necessary. If customer is upset due to services or product issue, agent should show empathy. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Did associate address the customer by his / her name?",
    maxScore: 5,
    description:
      "Agent should ask for customer name and address the customer appropriately. Use customer name and build rapport. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Was associate enthusiastic and energetic throughout the call?",
    maxScore: 5,
    description:
      "Agent should be energetic and enthusiastic throughout the call. Energy should be constant. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Did associate switch language as per customer language?",
    maxScore: 5,
    description:
      "Agent should switch language as per customer and use language that is easy for customer to understand. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Was associate attentive?",
    maxScore: 5,
    description: "Agent needs to be attentive to handle the call correctly. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Did associate control rate of speech?",
    maxScore: 5,
    description: "Rate of speech should be controlled and moderate. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Was associate fluent throughout the call?",
    maxScore: 5,
    description:
      "Agent should speak fluently and should not fumble or use fillers during conversation. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Did not interrupt and waited for customer to complete first?",
    maxScore: 4,
    description:
      "Agent should not interrupt customer while speaking. Let customer speak first and then answer. Agent should pause between information, listen without interrupting. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Was the hold procedure followed?",
    maxScore: 4,
    description:
      "Agent should adhere to script for hold and un-hold procedure. Hold duration should be according to process. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Was sentence formation / pronunciation up to the mark?",
    maxScore: 4,
    description:
      "Use complete sentences with correct pronunciation. Avoid grammatical errors. Use verbiage as per guidelines.",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Was associate confident on call?",
    maxScore: 3,
    description: "Associate needs to be confident throughout the call. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Varied tone and courteous",
    maxScore: 3,
    description:
      "Agent should change tone as per conversation and keep tone positive. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Dead air (should not exceed 10 sec)",
    maxScore: 3,
    description:
      "Avoid dead air on calls. Dead air should not exceed 10 seconds. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Did associate probe well to understand customer's query / concern?",
    maxScore: 5,
    description:
      "Appropriate probing should be done on call to understand customer need or concern. If agent did not probe to clarify customer concern or give appropriate answer, mark down.",
  },
  {
    category: "Product/Process handling",
    name: "Convincing for device pick-up/ Fake Leads generate",
    maxScore: 5,
    description:
      "Associate should convince the customer for device pickup. Mark down if associate generates leads without confirmation or closes sales incorrectly.",
  },
  {
    category: "Product/Process handling",
    name: "TAG the customer call correctly",
    maxScore: 5,
    description:
      "Call should be tagged with correct disposition. CRM should also be updated correctly and completely as per conversation. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Product/Process handling",
    name: "Did associate provided correct information to customer and did not make false commitment?",
    maxScore: 5,
    description:
      "Agent should provide correct and complete information to customer and must not make false commitments.",
  },
  {
    category: "Closing",
    name: "Did associate ask for further assistance?",
    maxScore: 3,
    description:
      "Agent should thank the customer for their time and ask for further assistance if required. If followed, mark Yes; otherwise No.",
  },
  {
    category: "Closing",
    name: "Did associate follow standard closing script?",
    maxScore: 3,
    description:
      "Agent should close the call as per closing guidelines. Do not mark down if call gets disconnected by customer before closing script. If followed, mark Yes; otherwise No.",
  },
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function key(category: string, name: string): string {
  return `${normalize(category)}::${normalize(name)}`;
}

function buildAiInstruction(p: BeetelParam): string {
  return `${p.description} ${BINARY_RULE}`;
}

async function main() {
  const totalScore = BEETEL_PARAMS.reduce((s, p) => s + p.maxScore, 0);
  if (BEETEL_PARAMS.length !== 24) {
    throw new Error(`Expected 24 Beetel parameters, got ${BEETEL_PARAMS.length}.`);
  }
  if (totalScore !== 100) {
    throw new Error(`Expected total score 100, got ${totalScore}.`);
  }

  const before = await prisma.clientParameter.findMany({
    where: { clientId: TARGET_CLIENT_ID },
    select: { isActive: true, maxScore: true },
  });
  const beforeActive = before.filter((p) => p.isActive).length;
  const beforeActiveScore = before
    .filter((p) => p.isActive)
    .reduce((s, p) => s + p.maxScore, 0);
  console.log(
    `Before: total=${before.length} active=${beforeActive} activeScore=${beforeActiveScore}`,
  );

  // --- 1. Rename client to Beetel -----------------------------------------
  // Avoid slug collision: if another row already uses "beetel", keep the
  // current slug rather than fail loudly.
  const slugClash = await prisma.client.findFirst({
    where: { slug: TARGET_SLUG, NOT: { id: TARGET_CLIENT_ID } },
    select: { id: true },
  });
  const renamed = await prisma.client.update({
    where: { id: TARGET_CLIENT_ID },
    data: {
      name: TARGET_NAME,
      slug: slugClash ? undefined : TARGET_SLUG,
    },
    select: { id: true, name: true, slug: true },
  });
  console.log(
    `Client renamed: ${JSON.stringify(renamed)}${slugClash ? "  (slug kept — collision with another client)" : ""}`,
  );

  // --- 2. Index existing parameters by (normalized category, name) --------
  const existing = await prisma.clientParameter.findMany({
    where: { clientId: TARGET_CLIENT_ID },
    select: {
      id: true,
      parameterCategory: true,
      parameterName: true,
      isActive: true,
    },
  });
  const existingByKey = new Map<string, (typeof existing)[number]>();
  for (const p of existing) existingByKey.set(key(p.parameterCategory, p.parameterName), p);

  // --- 3. Upsert each Beetel parameter ------------------------------------
  let updatedCount = 0;
  let createdCount = 0;
  const keepIds = new Set<string>();
  for (let i = 0; i < BEETEL_PARAMS.length; i++) {
    const p = BEETEL_PARAMS[i];
    const k = key(p.category, p.name);
    const ai = buildAiInstruction(p);
    const displayOrder = (i + 1) * 10;
    const match = existingByKey.get(k);
    if (match) {
      await prisma.clientParameter.update({
        where: { id: match.id },
        data: {
          parameterCategory: p.category,
          parameterName: p.name,
          parameterDescription: p.description,
          maxScore: p.maxScore,
          aiInstruction: ai,
          displayOrder,
          isActive: true,
        },
      });
      keepIds.add(match.id);
      updatedCount += 1;
    } else {
      const created = await prisma.clientParameter.create({
        data: {
          clientId: TARGET_CLIENT_ID,
          parameterCategory: p.category,
          parameterName: p.name,
          parameterDescription: p.description,
          maxScore: p.maxScore,
          aiInstruction: ai,
          displayOrder,
          isActive: true,
        },
        select: { id: true },
      });
      keepIds.add(created.id);
      createdCount += 1;
    }
  }

  // --- 4. Deactivate any leftover parameters (preserve history) -----------
  const leftovers = existing.filter((p) => !keepIds.has(p.id));
  let deactivatedCount = 0;
  for (const p of leftovers) {
    if (p.isActive) {
      await prisma.clientParameter.update({
        where: { id: p.id },
        data: { isActive: false },
      });
      deactivatedCount += 1;
    }
  }

  // --- 5. Handle stale custom audit prompt --------------------------------
  const customPrompts = await prisma.clientAuditPrompt.findMany({
    where: { clientId: TARGET_CLIENT_ID, isActive: true },
    select: { id: true, promptName: true, promptText: true },
  });
  let promptsDeactivated = 0;
  for (const p of customPrompts) {
    const stale =
      /acme/i.test(p.promptText) ||
      /acme/i.test(p.promptName) ||
      /\btest\b/i.test(p.promptName);
    if (stale) {
      await prisma.clientAuditPrompt.update({
        where: { id: p.id },
        data: { isActive: false },
      });
      promptsDeactivated += 1;
    }
  }

  // --- Final summary ------------------------------------------------------
  const after = await prisma.clientParameter.findMany({
    where: { clientId: TARGET_CLIENT_ID },
    select: { isActive: true, maxScore: true },
  });
  const afterActive = after.filter((p) => p.isActive).length;
  const afterActiveScore = after
    .filter((p) => p.isActive)
    .reduce((s, p) => s + p.maxScore, 0);
  console.log(
    `After:  total=${after.length} active=${afterActive} activeScore=${afterActiveScore}`,
  );
  console.log(
    `Counts: updated=${updatedCount} created=${createdCount} deactivated=${deactivatedCount} promptsDeactivated=${promptsDeactivated}`,
  );

  if (afterActive !== 24) {
    throw new Error(`Expected 24 active parameters, got ${afterActive}.`);
  }
  if (afterActiveScore !== 100) {
    throw new Error(`Expected active total score 100, got ${afterActiveScore}.`);
  }
  console.log("OK: Beetel parameter set is active. Total score = 100.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
