// Truncate call-only data so a fresh demo can be uploaded.
//
// Preserves: clients, client_access, campaigns, teams, agents,
//            client_parameters, client_audit_prompts, app settings,
//            uploaded audio files (storage/audio/*).
//
// Deletes: calls, call_transcripts, transcript_segments, ai_audits,
//          ai_parameter_scores, call_events, ai_insights, manual_reviews,
//          call_notes.
//
// Usage:
//   npm run truncate:demo-calls -- --yes
//
// Without --yes the script prints the planned counts and exits.

import "dotenv/config";
import readline from "node:readline/promises";
import { prisma } from "../src/lib/db";

function hasYesFlag(argv: string[]): boolean {
  return argv.includes("--yes") || argv.includes("-y");
}

async function countAll() {
  const [calls, transcripts, segments, audits, scores, events, insights, reviews, notes] =
    await Promise.all([
      prisma.call.count(),
      prisma.callTranscript.count(),
      prisma.transcriptSegment.count(),
      prisma.aiAudit.count(),
      prisma.aiParameterScore.count(),
      prisma.callEvent.count(),
      prisma.aiInsight.count(),
      prisma.manualReview.count(),
      prisma.callNote.count(),
    ]);
  return { calls, transcripts, segments, audits, scores, events, insights, reviews, notes };
}

async function countPreserved() {
  const [clients, access, campaigns, teams, agents, params, prompts] = await Promise.all([
    prisma.client.count(),
    prisma.clientAccess.count(),
    prisma.campaign.count(),
    prisma.team.count(),
    prisma.agent.count(),
    prisma.clientParameter.count(),
    prisma.clientAuditPrompt.count(),
  ]);
  return { clients, access, campaigns, teams, agents, params, prompts };
}

async function main(): Promise<number> {
  const yes = hasYesFlag(process.argv.slice(2));

  const before = await countAll();
  const preserved = await countPreserved();

  console.log("=== Demo call truncation plan ===");
  console.log("Will DELETE (call-scoped data):");
  console.table(before);
  console.log("Will PRESERVE (clients/parameters/prompts/settings):");
  console.table(preserved);
  console.log("Audio files in storage/audio/ are NOT touched by this script.");

  if (!yes) {
    if (process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ans = (await rl.question("\nProceed with deletion? Type 'yes' to confirm: ")).trim().toLowerCase();
      rl.close();
      if (ans !== "yes") {
        console.log("Aborted. No data deleted.");
        return 1;
      }
    } else {
      console.log("\nDry-run only. Re-run with --yes to actually delete.");
      return 0;
    }
  }

  console.log("\nDeleting call-scoped data…");
  // Order matters because of FKs that are not all CASCADE.
  await prisma.$transaction(async (tx) => {
    await tx.aiParameterScore.deleteMany({});
    await tx.aiInsight.deleteMany({});
    await tx.callEvent.deleteMany({});
    await tx.manualReview.deleteMany({});
    await tx.callNote.deleteMany({});
    await tx.transcriptSegment.deleteMany({});
    await tx.callTranscript.deleteMany({});
    await tx.aiAudit.deleteMany({});
    await tx.call.deleteMany({});
  });

  const after = await countAll();
  const preservedAfter = await countPreserved();
  console.log("\n=== After truncation ===");
  console.log("Call-scoped tables (should be all zeros):");
  console.table(after);
  console.log("Preserved tables (should match pre-truncation counts):");
  console.table(preservedAfter);
  console.log("\nDone. Audio files in storage/audio/ remain intact.");
  return 0;
}

main()
  .then((code) => {
    void prisma.$disconnect().then(() => process.exit(code));
  })
  .catch(async (e) => {
    console.error("Truncation failed:", e instanceof Error ? e.stack ?? e.message : e);
    await prisma.$disconnect().catch(() => {});
    process.exit(2);
  });
