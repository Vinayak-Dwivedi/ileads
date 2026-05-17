// Smoke test for the live (OpenRouter / Gemma) AI audit.
//
// Usage:
//   npm run smoke:audit -- --call <callId>
//
// Behaviour:
//   - Loads .env via dotenv (so OPENROUTER_API_KEY is available).
//   - Resolves the call by id (or auto-picks the first call with a transcript).
//   - Runs runLiveAuditForCall and prints score, parameter results, events.
//   - NEVER prints the OpenRouter API key. Only reports whether it is set.
//
// Exit codes: 0 success, non-zero on failure.

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runLiveAuditForCall, LiveAuditError } from "../src/services/audit";

function parseArgs(argv: string[]): { callId: string | null } {
  let callId: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--call" || a === "-c") {
      callId = argv[++i] ?? null;
    } else if (a?.startsWith("--call=")) {
      callId = a.slice("--call=".length);
    }
  }
  return { callId };
}

function fmt2(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

async function main(): Promise<number> {
  const { callId: argCallId } = parseArgs(process.argv.slice(2));

  const apiKeySet = Boolean(process.env.OPENROUTER_API_KEY && process.env.OPENROUTER_API_KEY.trim());
  console.log(`OPENROUTER_API_KEY set: ${apiKeySet ? "yes" : "no"}`);
  console.log(`OPENROUTER_AUDIT_MODEL: ${process.env.OPENROUTER_AUDIT_MODEL ?? "(default)"}`);

  if (!apiKeySet) {
    console.error(
      "OPENROUTER_API_KEY is not set. Add it to .env and re-run. (No request will be made.)",
    );
    return 2;
  }

  let callId = argCallId;
  if (!callId) {
    const candidate = await prisma.call.findFirst({
      where: { transcript: { isNot: null } },
      orderBy: { createdAt: "desc" },
      select: { id: true, clientId: true, externalCallId: true },
    });
    if (!candidate) {
      console.error("No call with a transcript found. Pass --call <callId> after running transcription.");
      return 3;
    }
    callId = candidate.id;
    console.log(`Auto-selected call: ${candidate.externalCallId ?? callId} (${callId})`);
  }

  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: { id: true, clientId: true, externalCallId: true },
  });
  if (!call) {
    console.error(`Call not found: ${callId}`);
    return 4;
  }

  console.log(`Running live audit for call ${call.externalCallId ?? call.id} (${call.id})...`);
  const start = Date.now();
  try {
    const result = await runLiveAuditForCall(call.id, call.clientId);
    const elapsedMs = Date.now() - start;

    console.log(`\n=== Live audit complete in ${(elapsedMs / 1000).toFixed(2)}s ===`);
    console.log(`Audit run #:    ${result.audit.auditRunNo}`);
    console.log(`Model used:     ${result.model}`);
    console.log(`Attempts:       ${result.attempts}`);
    console.log(
      `Score:          ${result.validated.overallScore} / ${result.validated.maxPossibleScore} (${fmt2(
        result.validated.scorePercent,
      )}%)`,
    );
    console.log(`Sentiment:      ${result.validated.sentiment}`);
    console.log(`Agent tone:     ${result.validated.agentTone}`);
    console.log(`Compliance:     ${result.validated.complianceSeverity}`);
    if (result.usage) {
      console.log(
        `Tokens:         prompt=${result.usage.promptTokens ?? "?"} completion=${result.usage.completionTokens ?? "?"} total=${result.usage.totalTokens ?? "?"}`,
      );
    }

    console.log("\n--- Parameter scores ---");
    for (const p of result.validated.parameterScores) {
      const evid = p.evidenceText ? ` :: "${p.evidenceText.slice(0, 80)}"` : "";
      console.log(
        `  ${p.result.padEnd(9)} ${String(p.awardedScore).padStart(2)}/${String(p.maxScore).padEnd(2)}  ${p.parameterName}${evid}`,
      );
    }

    console.log("\n--- Events ---");
    if (result.validated.events.length === 0) {
      console.log("  (none)");
    } else {
      for (const e of result.validated.events) {
        console.log(
          `  [${e.severity}] ${e.eventType} (${e.speaker})  ${e.title}` +
            (e.evidenceText ? ` :: "${e.evidenceText.slice(0, 80)}"` : ""),
        );
      }
    }

    if (result.validated.warnings.length > 0) {
      console.log("\n--- Validator warnings ---");
      for (const w of result.validated.warnings) console.log(`  - ${w}`);
    }

    return 0;
  } catch (e) {
    if (e instanceof LiveAuditError) {
      console.error(`Live audit failed: ${e.code} :: ${e.message}`);
      return 5;
    }
    console.error("Live audit failed:", e instanceof Error ? e.message : String(e));
    return 6;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch(async (err) => {
    console.error("Unhandled error:", err instanceof Error ? err.stack ?? err.message : err);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
