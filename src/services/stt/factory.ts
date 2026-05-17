import "server-only";
import { existsSync, readdirSync } from "node:fs";
import { loadSttConfig, resolveModelChain, type SttConfig, type SttModelConfig } from "./config";
import { MockSttEngine } from "./engines/mockSttEngine";
import { PythonSttEngine } from "./engines/pythonEngine";
import { SarvamSttEngine } from "./engines/sarvamEngine";
import { evaluateSttQuality } from "./quality";
import { SttError, type SttEngine, type SttResult } from "./types";

export function isMockMode(config: SttConfig = loadSttConfig()): boolean {
  return config.mock === true;
}

export function shouldShowMockActions(config: SttConfig = loadSttConfig()): boolean {
  return config.showMockActions || process.env.NODE_ENV === "development";
}

export function isSarvamProvider(config: SttConfig = loadSttConfig()): boolean {
  return config.provider === "sarvam";
}

export function hasSarvamKey(config: SttConfig = loadSttConfig()): boolean {
  return config.sarvam.apiKey.trim().length > 0;
}

/** Build a python-backed engine for the given model config. */
export function createEngineForModel(model: SttModelConfig, config: SttConfig): SttEngine {
  return new PythonSttEngine({ modelConfig: model, config });
}

/**
 * Returns the primary engine. In mock mode this is the mock engine; otherwise
 * the PythonSttEngine for STT_PRIMARY_MODEL.
 */
export function getSttEngine(config: SttConfig = loadSttConfig()): SttEngine {
  if (config.mock) return new MockSttEngine();
  if (config.provider === "sarvam") return new SarvamSttEngine(config);
  return createEngineForModel(config.primary, config);
}

/** Looks up a specific engine by model key (e.g. for smoke tests). */
export function getEngineByKey(key: string, config: SttConfig = loadSttConfig()): SttEngine {
  if (key === "mock") return new MockSttEngine();
  if (key === "sarvam") return new SarvamSttEngine(config);
  for (const m of [config.primary, config.fallback1, config.fallback2]) {
    if (m.key === key) return createEngineForModel(m, config);
  }
  throw new SttError("NOT_IMPLEMENTED", `Unknown STT model key: ${key}`);
}

export interface AttemptResult {
  provider: string;
  model: string;
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  qualityFlags?: string[];
  durationMs: number;
}

export interface ChainResult {
  /** The successful STT result, if any model in the chain produced one. */
  result: SttResult | null;
  /** Per-model outcome in chain order. */
  attempts: AttemptResult[];
  /** Model key that produced `result` (null on total failure). */
  winningModel: string | null;
  fallbackReason: string | null;
  qualityFlags: string[];
}

/**
 * Runs the configured demo STT provider. For STT_PROVIDER=sarvam, Sarvam runs
 * first and the local chain is used only as fallback when enabled. For
 * STT_PROVIDER=local, the local chain runs directly.
 */
export async function transcribeWithChain(
  audioPath: string,
  config: SttConfig = loadSttConfig(),
): Promise<ChainResult> {
  if (config.mock) {
    // Mock mode short-circuits to a single successful "attempt".
    const engine = new MockSttEngine();
    const t0 = Date.now();
    const result = await engine.transcribe(audioPath);
    return {
      result,
      winningModel: "mock",
      fallbackReason: null,
      qualityFlags: [],
      attempts: [{ provider: "mock", model: "mock", ok: true, durationMs: Date.now() - t0 }],
    };
  }

  const chain =
    config.provider === "sarvam"
      ? [
          {
            provider: "sarvam",
            model: config.sarvam.model,
            engine: new SarvamSttEngine(config),
            qualityGate: false,
          },
          ...(config.localSttEnabled ? localAttempts(config) : []),
        ]
      : localAttempts(config);

  const attempts: AttemptResult[] = [];
  let fallbackReason: string | null = null;

  for (let index = 0; index < chain.length; index++) {
    const attempt = chain[index];
    const hasFallbackAfterThis = index < chain.length - 1;

    if (
      attempt.provider === "local" &&
      attempt.modelConfig &&
      config.skipMissingModels &&
      !looksPopulatedModelDir(attempt.modelConfig.modelPath)
    ) {
      if (index === 0) fallbackReason = "primary_model_missing";
      attempts.push({
        provider: attempt.provider,
        model: attempt.model,
        ok: false,
        errorCode: "MODEL_NOT_FOUND",
        errorMessage: `Model directory is empty: ${attempt.modelConfig.modelPath}. Run scripts/stt/download-models.sh.`,
        durationMs: 0,
      });
      continue;
    }

    const t0 = Date.now();
    try {
      const result = await attempt.engine.transcribe(audioPath);
      const quality = attempt.qualityGate ? evaluateSttQuality(result) : { ok: true, flags: [] };
      if (!quality.ok && hasFallbackAfterThis) {
        fallbackReason = fallbackReason ?? "primary_quality_failed";
        attempts.push({
          provider: attempt.provider,
          model: attempt.model,
          ok: false,
          errorCode: "QUALITY_GATE",
          errorMessage: `Transcript failed quality gate: ${quality.flags.join(", ")}`,
          qualityFlags: quality.flags,
          durationMs: Date.now() - t0,
        });
        continue;
      }

      const resultQualityFlags = [...new Set([...(result.qualityFlags ?? []), ...quality.flags])];
      result.qualityFlags = resultQualityFlags;
      result.fallbackReason = fallbackReason;
      attempts.push({
        provider: attempt.provider,
        model: attempt.model,
        ok: true,
        qualityFlags: resultQualityFlags,
        durationMs: Date.now() - t0,
      });
      return {
        result,
        attempts,
        winningModel: attempt.model,
        fallbackReason,
        qualityFlags: resultQualityFlags,
      };
    } catch (e) {
      const code = e instanceof SttError ? e.code : "TRANSCRIBE_FAILED";
      const message = e instanceof Error ? e.message : String(e);
      if (index === 0) {
        if (attempt.provider === "sarvam") fallbackReason = "sarvam_failed";
        else fallbackReason = code === "MODEL_NOT_FOUND" ? "primary_model_missing" : "primary_model_failed";
      }
      attempts.push({
        provider: attempt.provider,
        model: attempt.model,
        ok: false,
        errorCode: code,
        errorMessage: message,
        durationMs: Date.now() - t0,
      });
      if (code === "SARVAM_API_KEY_MISSING") break;
      // Try the next model in the chain.
    }
  }

  return { result: null, attempts, winningModel: null, fallbackReason, qualityFlags: [] };
}

/** Backwards-compatible alias for older callers. */
export function createSttProvider(): SttEngine {
  return getSttEngine();
}

function looksPopulatedModelDir(modelPath: string): boolean {
  if (!modelPath || !existsSync(modelPath)) return false;
  try {
    const entries = readdirSync(modelPath).filter((name) => name !== ".gitkeep");
    if (!entries.length) return false;
    return entries.includes("config.json") || entries.includes("model.bin");
  } catch {
    return false;
  }
}

interface RuntimeAttempt {
  provider: string;
  model: string;
  engine: SttEngine;
  qualityGate: boolean;
  modelConfig?: SttModelConfig;
}

function localAttempts(config: SttConfig): RuntimeAttempt[] {
  return resolveModelChain(config).map((model) => ({
    provider: "local",
    model: model.key,
    engine: createEngineForModel(model, config),
    qualityGate: true,
    modelConfig: model,
  }));
}
