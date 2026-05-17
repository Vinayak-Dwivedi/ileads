/**
 * STT smoke test.
 *
 * Picks the shortest supported audio file under storage/audio and runs the
 * selected STT model(s) against it. Prints per-attempt outcome + first few
 * segments. Does NOT write to the database.
 *
 * Usage:
 *   npm run smoke:stt                                  # use configured primary
 *   npm run smoke:stt -- --chain                       # fixed product chain
 *   npm run smoke:stt -- --provider sarvam
 *   npm run smoke:stt -- --model indicconformer
 *   npm run smoke:stt -- --model faster-whisper-small
 *   npm run smoke:stt -- --model mock
 *   npm run smoke:stt -- --file /abs/path/audio.wav --chain
 */
import "dotenv/config";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ACCEPTED_AUDIO_EXTENSIONS, getAudioStorageRoot } from "../src/lib/audio-storage";
import {
  getEngineByKey,
  loadSttConfig,
  resolveModelChain,
  SttError,
  transcribeWithChain,
  type SttEngine,
  type SttResult,
} from "../src/services/stt";
import { evaluateSttQuality } from "../src/services/stt/quality";

interface Args {
  file?: string;
  provider?: "sarvam" | "local";
  model: string; // 'mock' | <model-key>
  chain: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { model: "primary", chain: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") args.file = argv[++i];
    else if (a === "--provider") {
      const provider = argv[++i];
      if (provider === "sarvam" || provider === "local") args.provider = provider;
      else {
        console.error(`!! unsupported --provider: ${provider}`);
        process.exit(2);
      }
    }
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--chain") args.chain = true;
  }
  return args;
}

function pickAudioFile(explicit?: string): string | null {
  if (explicit) {
    const candidate = path.resolve(explicit);
    if (!existsSync(candidate)) {
      console.error(`!! --file path not found: ${candidate}`);
      process.exit(2);
    }
    return candidate;
  }
  const root = getAudioStorageRoot();
  if (!existsSync(root)) return null;
  const entries = readdirSync(root)
    .filter((name) => ACCEPTED_AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .map((name) => path.join(root, name))
    .filter((full) => {
      try {
        const s = statSync(full);
        return s.isFile() && s.size > 1024; // skip 44-byte stubs
      } catch {
        return false;
      }
    });
  if (!entries.length) return null;
  entries.sort((a, b) => statSync(a).size - statSync(b).size);
  return entries[0];
}

function printResult(result: SttResult, modelLabel: string, elapsedMs: number): void {
  const quality = result.qualityFlags?.length
    ? { flags: result.qualityFlags, ok: !result.qualityFlags.some((flag) => flag !== "heuristic_speaker_labels") }
    : evaluateSttQuality(result);
  console.log(`OK in ${(elapsedMs / 1000).toFixed(2)}s — ${result.segments.length} segments`);
  console.log(`  model    : ${modelLabel}`);
  console.log(`  provider : ${result.provider}`);
  console.log(`  language : ${result.language}`);
  console.log(`  quality  : ${quality.ok ? "pass" : "fail"}${quality.flags.length ? ` (${quality.flags.join(", ")})` : ""}`);
  const totalChars = result.fullText.length;
  console.log(`  text len : ${totalChars} chars`);
  console.log("");
  console.log("First segments:");
  for (const seg of result.segments.slice(0, 5)) {
    const start = (seg.startMs / 1000).toFixed(2);
    const end = (seg.endMs / 1000).toFixed(2);
    const conf = seg.confidenceScore != null ? ` (conf=${seg.confidenceScore.toFixed(3)})` : "";
    const speaker = seg.speaker ?? "UNKNOWN";
    const channel = seg.channel ? `/${seg.channel}` : "";
    const source = seg.speakerSource ? `/${seg.speakerSource}` : "";
    console.log(`  [${start}s -> ${end}s] ${speaker}${channel}${source}${conf} ${seg.text}`);
  }
  if (result.segments.length > 5) {
    console.log(`  ... +${result.segments.length - 5} more`);
  }
}

async function runSingle(engine: SttEngine, audio: string): Promise<void> {
  const t0 = Date.now();
  try {
    const result = await engine.transcribe(audio);
    printResult(result, engine.name, Date.now() - t0);
  } catch (e) {
    if (e instanceof SttError) {
      console.error(`!! ${engine.name} failed [${e.code}]: ${e.message}`);
      if (e.details) console.error("   details:", JSON.stringify(e.details).slice(0, 500));
      process.exitCode = 4;
    } else {
      console.error("!! unexpected error:", e);
      process.exitCode = 5;
    }
  }
}

async function runChain(audio: string): Promise<void> {
  const config = loadSttConfig();
  console.log("Fixed product chain — running models in order:");
  const chain = resolveModelChain(config);
  if (config.provider === "sarvam") {
    console.log(`  - sarvam:${config.sarvam.model}`);
    if (config.localSttEnabled) {
      for (const m of chain) console.log(`  - local:${m.key} (${m.modelPath})`);
    }
  } else {
    for (const m of chain) console.log(`  - local:${m.key} (${m.modelPath})`);
  }
  console.log("");

  const t0 = Date.now();
  const outcome = await transcribeWithChain(audio, config);
  const elapsed = Date.now() - t0;

  console.log("Chain attempts:");
  for (const a of outcome.attempts) {
    const flag = a.ok ? "OK " : "FAIL";
    const err = a.ok ? "" : ` [${a.errorCode}] ${a.errorMessage}`;
    const quality = a.qualityFlags?.length ? ` flags=${a.qualityFlags.join(",")}` : "";
    console.log(`  ${flag}  ${a.provider}:${a.model}  (${(a.durationMs / 1000).toFixed(2)}s)${err}${quality}`);
  }
  console.log("");

  if (outcome.result && outcome.winningModel) {
    console.log(`Winner: ${outcome.winningModel}`);
    if (outcome.fallbackReason) console.log(`Fallback reason: ${outcome.fallbackReason}`);
    printResult(outcome.result, outcome.winningModel, elapsed);
  } else {
    console.error("!! Every model in the chain failed.");
    process.exitCode = 6;
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const config = loadSttConfig();
  if (args.provider) {
    config.provider = args.provider;
  }

  console.log("== STT smoke test ==");
  console.log(`  MOCK_STT         : ${config.mock}`);
  console.log(`  primary model    : ${config.primary.key} (${config.primary.modelPath})`);
  console.log(`  provider         : ${config.provider}`);
  if (config.provider === "sarvam") {
    console.log(`  sarvam model     : ${config.sarvam.model}`);
    console.log(`  sarvam batch     : ${config.sarvam.useBatch}`);
    console.log(`  local fallback   : ${config.localSttEnabled}`);
  }
  console.log(`  fallback enabled : ${config.enableFallback}`);
  console.log(`  fallback order   : ${config.fallbackOrder.join(", ") || "(none)"}`);
  console.log(`  python bin       : ${config.pythonBin}`);
  console.log("");

  const audio = pickAudioFile(args.file);
  if (!audio) {
    console.error("!! No supported audio file found in storage/audio. Use --file <path>.");
    process.exit(2);
  }
  console.log(`Audio file: ${audio}`);
  try {
    const sz = statSync(audio).size;
    console.log(`Audio size: ${(sz / 1024 / 1024).toFixed(2)} MB`);
  } catch {
    /* ignore */
  }
  console.log("");

  if (args.chain) {
    await runChain(audio);
    return;
  }

  if (args.model === "mock" || args.model === "primary") {
    // Default "primary" honors MOCK_STT so the smoke test never accidentally
    // hits the heavyweight Python pipeline when the app is in mock mode.
    const key =
      args.model === "mock"
        ? "mock"
        : config.mock
          ? "mock"
          : config.provider === "sarvam"
            ? "sarvam"
            : config.primary.key;
    const engine = getEngineByKey(key, config);
    console.log(`Engine    : ${engine.name}`);
    console.log("");
    await runSingle(engine, audio);
    return;
  }

  try {
    const engine = getEngineByKey(args.model, config);
    console.log(`Engine    : ${engine.name}`);
    console.log("");
    await runSingle(engine, audio);
  } catch (e) {
    if (e instanceof SttError) {
      console.error(`!! ${e.code}: ${e.message}`);
      process.exit(3);
    }
    throw e;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
