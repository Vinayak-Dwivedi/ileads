// Direct test of the OpenRouter audit LLM using the EXACT .env config
// (model + fallback + JSON mode). No database needed — isolates "is the
// configured audit model actually reachable and returning usable JSON?".
//
// Usage: npm run test:audit-llm
import "dotenv/config";
import { loadOpenRouterConfig, openrouterChat } from "../src/services/llm";

async function main(): Promise<number> {
  const cfg = loadOpenRouterConfig();
  console.log("=== OpenRouter audit LLM check ===");
  console.log(`  provider        : ${cfg.provider}`);
  console.log(`  model           : ${cfg.model}`);
  console.log(`  fallback models : ${cfg.fallbackModels.length ? cfg.fallbackModels.join(", ") : "(none)"}`);
  console.log(`  api key set     : ${cfg.apiKey ? "yes" : "no"}`);
  console.log(`  base url        : ${cfg.baseUrl}`);
  if (!cfg.apiKey) {
    console.error("\nNo API key for the selected AUDIT_PROVIDER. Aborting (no request made).");
    return 2;
  }

  const t0 = Date.now();
  const outcome = await openrouterChat<{ verdict: string; score: number }>(
    {
      messages: [
        {
          role: "system",
          content:
            "You are a QA auditor. Reply ONLY with a JSON object, no prose. " +
            'Schema: {"verdict": string, "score": number (0-10)}.',
        },
        {
          role: "user",
          content:
            'Audit this one-line call: Agent: "Thank you for calling, how can I help?" ' +
            "Rate politeness 0-10 and give a one-word verdict.",
        },
      ],
      temperature: 0.1,
      maxTokens: 300,
      requestJson: true,
    },
    cfg,
  );

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  if (!outcome.ok) {
    console.error(`\nFAILED in ${elapsed}s`);
    console.error(`  code    : ${outcome.code}`);
    console.error(`  status  : ${outcome.status ?? "—"}`);
    console.error(`  message : ${outcome.message}`);
    return 1;
  }

  console.log(`\nSUCCESS in ${elapsed}s`);
  console.log(`  model echoed : ${outcome.model}`);
  console.log(`  attempts     : ${outcome.attempts}`);
  console.log(`  raw content  : ${outcome.content.slice(0, 300)}`);
  console.log(`  parsed JSON  : ${outcome.parsed ? JSON.stringify(outcome.parsed) : "NULL (model did not return parseable JSON)"}`);
  if (outcome.usage) {
    console.log(
      `  tokens       : prompt=${outcome.usage.promptTokens ?? "?"} completion=${outcome.usage.completionTokens ?? "?"} total=${outcome.usage.totalTokens ?? "?"}`,
    );
  }
  if (!outcome.parsed) {
    console.warn("\nWARNING: model returned content but not parseable JSON — audit validation would reject this.");
    return 3;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("Unhandled error:", e instanceof Error ? e.stack ?? e.message : e);
    process.exit(1);
  });
