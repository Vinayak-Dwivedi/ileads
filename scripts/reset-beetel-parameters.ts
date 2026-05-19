/**
 * Hard-reset the Beetel parameter set.
 *
 *  - Refuses to run while any call-scoped data (calls/audits/scores) is
 *    present. Run `npm run truncate:demo-calls -- --yes` first so the FK
 *    constraint on ai_parameter_scores → client_parameters can be satisfied.
 *  - Deletes ALL client_parameters for the Beetel client (active + inactive).
 *  - Deactivates any stale active custom audit prompt so the generated
 *    default rebuilds from the new parameter set.
 *  - Recreates the 24 Beetel sub-parameters with their final scores.
 *  - Maps each to one of the 10 final standard parameters (must be seeded
 *    first by `npm run import:standard-parameters`).
 *  - Asserts: 24 active, 0 inactive, total score 100, no unmapped rows.
 *
 * Run:  npm run reset:beetel-parameters
 */

import { prisma } from "../src/lib/db";

let TARGET_CLIENT_ID = "cmp8awxnz0000l4n9g9wzs8vy"; // Beetel

const BINARY_RULE =
  "Binary scoring: mark pass only if behavior is clearly fulfilled in the transcript; " +
  "if evidence is missing, mark not_found; if not fulfilled, mark fail. " +
  "pass = full score; fail or not_found = 0.";

interface BeetelParam {
  category: string;
  name: string;
  description: string;
  maxScore: number;
  standardName: string;
}

// Final mapping per the demo spec. Total awarded max_score must be 100.
const BEETEL_PARAMS: BeetelParam[] = [
  // Opening / Greeting (9)
  {
    category: "Opening",
    name: "Did associate open the call with in 3 secs?",
    description: "Opening should be prompt within 3 seconds. If followed, mark Yes; otherwise No.",
    maxScore: 3,
    standardName: "Opening / Greeting",
  },
  {
    category: "Opening",
    name: "Did associate greet the customer appropriately?",
    description:
      "In greeting, agent should not use hello, hi, or casual words. If followed, mark Yes; otherwise No.",
    maxScore: 3,
    standardName: "Opening / Greeting",
  },
  {
    category: "Opening",
    name: "Did associate do branding?",
    description: "Proper and clear usage of brand name on call. If followed, mark Yes; otherwise No.",
    maxScore: 3,
    standardName: "Opening / Greeting",
  },

  // Listening & Probing (9)
  {
    category: "Call Handling/ Soft skills",
    name: "Did associate ask for customer query/concern/relevant questions asked?",
    description:
      "Appropriate probing should be done on call as per call scenario. If agent did not probe to clarify customer concern or give appropriate answer, mark down.",
    maxScore: 4,
    standardName: "Listening & Probing",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Did associate probe well to understand customer's query / concern?",
    description:
      "Appropriate probing should be done on call to understand customer need or concern. If agent did not probe to clarify customer concern or give appropriate answer, mark down.",
    maxScore: 5,
    standardName: "Listening & Probing",
  },

  // Empathy & Courtesy (13)
  {
    category: "Call Handling/ Soft skills",
    name: "Did associate acknowledge customer query / concern?",
    description:
      "Provide frequent indicators or acknowledgement that the agent is listening to the customer. Customer should feel that their voice is being listened to and captured properly.",
    maxScore: 5,
    standardName: "Empathy & Courtesy",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Did associate apologized / sympathised (if required)",
    description:
      "Approach customer with compassion and apologies when necessary. If customer is upset due to services or product issue, agent should show empathy.",
    maxScore: 5,
    standardName: "Empathy & Courtesy",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Varied tone and courteous",
    description:
      "Agent should change tone as per conversation and keep tone positive. If followed, mark Yes; otherwise No.",
    maxScore: 3,
    standardName: "Empathy & Courtesy",
  },

  // Customer Verification (5)
  {
    category: "Call Handling/ Soft skills",
    name: "Did associate address the customer by his / her name?",
    description:
      "Agent should ask for customer name and address the customer appropriately. Use customer name and build rapport.",
    maxScore: 5,
    standardName: "Customer Verification",
  },

  // Communication Skills (27)
  {
    category: "Call Handling/ Soft skills",
    name: "Was associate enthusiastic and energetic throughout the call?",
    description: "Agent should be energetic and enthusiastic throughout the call. Energy should be constant.",
    maxScore: 5,
    standardName: "Communication Skills",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Was associate attentive?",
    description: "Agent needs to be attentive to handle the call correctly.",
    maxScore: 5,
    standardName: "Communication Skills",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Did associate control rate of speech?",
    description: "Rate of speech should be controlled and moderate.",
    maxScore: 5,
    standardName: "Communication Skills",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Was associate fluent throughout the call?",
    description:
      "Agent should speak fluently and should not fumble or use fillers during conversation.",
    maxScore: 5,
    standardName: "Communication Skills",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Was sentence formation / pronunciation up to the mark?",
    description:
      "Use complete sentences with correct pronunciation. Avoid grammatical errors. Use verbiage as per guidelines.",
    maxScore: 4,
    standardName: "Communication Skills",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Was associate confident on call?",
    description: "Associate needs to be confident throughout the call.",
    maxScore: 3,
    standardName: "Communication Skills",
  },

  // Call Purpose Identification (5)
  {
    category: "Call Handling/ Soft skills",
    name: "Did associate switch language as per customer language?",
    description:
      "Agent should switch language as per customer and use language that is easy for customer to understand.",
    maxScore: 5,
    standardName: "Call Purpose Identification",
  },

  // Resolution / Assistance Quality (11)
  {
    category: "Call Handling/ Soft skills",
    name: "Did not interrupt and waited for customer to complete first?",
    description:
      "Agent should not interrupt customer while speaking. Let customer speak first and then answer. Agent should pause between information, listen without interrupting.",
    maxScore: 4,
    standardName: "Resolution / Assistance Quality",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Was the hold procedure followed?",
    description:
      "Agent should adhere to script for hold and un-hold procedure. Hold duration should be according to process.",
    maxScore: 4,
    standardName: "Resolution / Assistance Quality",
  },
  {
    category: "Call Handling/ Soft skills",
    name: "Dead air (should not exceed 10 sec)",
    description: "Avoid dead air on calls. Dead air should not exceed 10 seconds.",
    maxScore: 3,
    standardName: "Resolution / Assistance Quality",
  },

  // Product / Process Knowledge (5)
  {
    category: "Product/Process handling",
    name: "Convincing for device pick-up/ Fake Leads generate",
    description:
      "Associate should convince the customer for device pickup. Mark down if associate generates leads without confirmation or closes sales incorrectly.",
    maxScore: 5,
    standardName: "Product / Process Knowledge",
  },

  // Compliance (10)
  {
    category: "Product/Process handling",
    name: "TAG the customer call correctly",
    description:
      "Call should be tagged with correct disposition. CRM should also be updated correctly and completely as per conversation.",
    maxScore: 5,
    standardName: "Compliance",
  },
  {
    category: "Product/Process handling",
    name: "Did associate provided correct information to customer and did not make false commitment?",
    description:
      "Agent should provide correct and complete information to customer and must not make false commitments.",
    maxScore: 5,
    standardName: "Compliance",
  },

  // Closing & Documentation (6)
  {
    category: "Closing",
    name: "Did associate ask for further assistance?",
    description:
      "Agent should thank the customer for their time and ask for further assistance if required.",
    maxScore: 3,
    standardName: "Closing & Documentation",
  },
  {
    category: "Closing",
    name: "Did associate follow standard closing script?",
    description:
      "Agent should close the call as per closing guidelines. Do not mark down if call gets disconnected by customer before closing script.",
    maxScore: 3,
    standardName: "Closing & Documentation",
  },
];

async function assertCallDataEmpty() {
  const [calls, audits, scores, transcripts] = await Promise.all([
    prisma.call.count(),
    prisma.aiAudit.count(),
    prisma.aiParameterScore.count(),
    prisma.callTranscript.count(),
  ]);
  if (calls + audits + scores + transcripts > 0) {
    throw new Error(
      `Refusing to delete parameters while call-scoped data exists ` +
        `(calls=${calls} audits=${audits} scores=${scores} transcripts=${transcripts}). ` +
        `Run \`npm run truncate:demo-calls -- --yes\` first.`,
    );
  }
}

async function main() {
  const beetelClient = await prisma.client.findFirst({
    where: { slug: "beetel" },
  });
  if (!beetelClient) {
    throw new Error("Beetel client not found in database.");
  }
  TARGET_CLIENT_ID = beetelClient.id;

  const totalScore = BEETEL_PARAMS.reduce((s, p) => s + p.maxScore, 0);
  if (BEETEL_PARAMS.length !== 24) {
    throw new Error(`Expected 24 Beetel parameters, got ${BEETEL_PARAMS.length}.`);
  }
  if (totalScore !== 100) {
    throw new Error(`Expected total score 100, got ${totalScore}.`);
  }

  // --- 1. Sanity: client exists -------------------------------------------
  const client = await prisma.client.findUnique({
    where: { id: TARGET_CLIENT_ID },
    select: { id: true, name: true },
  });
  if (!client) {
    throw new Error(`Beetel client ${TARGET_CLIENT_ID} not found.`);
  }
  console.log(`Client: ${client.name} (${client.id})`);

  // --- 2. Sanity: call-scoped data is empty -------------------------------
  await assertCallDataEmpty();

  // --- 3. Standard parameters must be the final 10 -------------------------
  const standards = await prisma.standardAuditParameter.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  if (standards.length !== 10) {
    throw new Error(
      `Expected 10 active standard parameters, got ${standards.length}. ` +
        `Run \`npm run import:standard-parameters\` first.`,
    );
  }
  const byStandardName = new Map(standards.map((s) => [s.name, s.id]));
  for (const p of BEETEL_PARAMS) {
    if (!byStandardName.has(p.standardName)) {
      throw new Error(`Standard parameter "${p.standardName}" not active. Re-seed standards.`);
    }
  }

  // --- 4. Delete every existing Beetel client_parameter -------------------
  const before = await prisma.clientParameter.count({ where: { clientId: TARGET_CLIENT_ID } });
  await prisma.clientParameter.deleteMany({ where: { clientId: TARGET_CLIENT_ID } });
  console.log(`Deleted ${before} existing Beetel parameters.`);

  // --- 5. Deactivate any active stale custom prompt -----------------------
  const stalePrompts = await prisma.clientAuditPrompt.findMany({
    where: { clientId: TARGET_CLIENT_ID, isActive: true },
    select: { id: true, promptName: true, promptText: true },
  });
  let deactivated = 0;
  for (const p of stalePrompts) {
    await prisma.clientAuditPrompt.update({ where: { id: p.id }, data: { isActive: false } });
    deactivated += 1;
  }
  console.log(`Deactivated ${deactivated} custom audit prompt(s).`);

  // --- 6. Recreate the 24 Beetel parameters with mappings -----------------
  for (let i = 0; i < BEETEL_PARAMS.length; i++) {
    const p = BEETEL_PARAMS[i];
    await prisma.clientParameter.create({
      data: {
        clientId: TARGET_CLIENT_ID,
        parameterCategory: p.standardName,
        parameterName: p.name,
        parameterDescription: p.description,
        maxScore: p.maxScore,
        aiInstruction: `${p.description} ${BINARY_RULE}`,
        displayOrder: (i + 1) * 10,
        isActive: true,
        standardParameterId: byStandardName.get(p.standardName) ?? null,
      },
    });
  }

  // --- 7. Final assertions ------------------------------------------------
  const after = await prisma.clientParameter.findMany({
    where: { clientId: TARGET_CLIENT_ID },
    include: { standardParameter: true },
    orderBy: { displayOrder: "asc" },
  });
  const active = after.filter((p) => p.isActive);
  const inactive = after.filter((p) => !p.isActive);
  const activeScore = active.reduce((s, p) => s + p.maxScore, 0);
  const unmapped = active.filter((p) => !p.standardParameterId).map((p) => p.parameterName);

  console.log(
    `Result: total=${after.length} active=${active.length} inactive=${inactive.length} activeScore=${activeScore}`,
  );

  if (active.length !== 24) throw new Error(`Expected 24 active, got ${active.length}.`);
  if (inactive.length !== 0) throw new Error(`Expected 0 inactive, got ${inactive.length}.`);
  if (activeScore !== 100) throw new Error(`Expected total score 100, got ${activeScore}.`);
  if (unmapped.length > 0) {
    throw new Error(`Unmapped active parameters: ${unmapped.join(", ")}`);
  }
  console.log("OK: 24 active Beetel parameters, total 100, all mapped to a standard parameter.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
