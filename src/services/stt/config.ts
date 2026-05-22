import "server-only";
import path from "node:path";

export interface SttModelConfig {
  /** Stable key used by the Python script and fallback ordering. */
  key: string;
  provider: string;
  /** Repo identifier (e.g. HuggingFace repo id), for diagnostics. */
  repo: string;
  modelPath: string;
  device: "auto" | "cpu" | "cuda";
  language: string;
  enabled: boolean;
}

export interface SttConfig {
  mock: boolean;
  showMockActions: boolean;
  provider: "local" | "sarvam" | "deepgram";
  pythonBin: string;
  scriptDir: string;
  runtimeDir: string;
  timeoutSeconds: number;
  localSttEnabled: boolean;

  sarvam: SarvamSttConfig;

  primary: SttModelConfig;
  fallback1: SttModelConfig;
  fallback2: SttModelConfig;

  enableFallback: boolean;
  skipMissingModels: boolean;
  /** Ordered model keys to try after primary, in order. Empty == primary only. */
  fallbackOrder: string[];

  confidenceGood: number;
  confidenceFallback: number;
  chunkSeconds: number;
  chunkOverlapSeconds: number;
  sampleRate: number;
}

export interface SarvamSttConfig {
  apiKey: string;
  model: string;
  mode: string;
  timeoutSeconds: number;
  enableDiarization: boolean;
  useBatch: boolean;
  batchPollIntervalSeconds: number;
  batchTimeoutSeconds: number;
  speakerMappingMode: "fixed" | "heuristic" | "raw";
  mapSpeakersToAgentCustomer: boolean;
  firstSpeaker: "agent" | "customer" | "unknown";
  secondSpeaker: "agent" | "customer" | "unknown";
}

function envStr(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const v = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  return fallback;
}

function envProvider(
  name: string,
  fallback: "local" | "sarvam" | "deepgram",
): "local" | "sarvam" | "deepgram" {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (raw === "local" || raw === "sarvam" || raw === "deepgram") return raw;
  return fallback;
}

function envDevice(name: string, fallback: "auto" | "cpu" | "cuda"): "auto" | "cpu" | "cuda" {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (raw === "auto" || raw === "cpu" || raw === "cuda") return raw;
  return fallback;
}

function envSpeaker(name: string, fallback: "agent" | "customer" | "unknown"): "agent" | "customer" | "unknown" {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (raw === "agent" || raw === "customer" || raw === "unknown") return raw;
  return fallback;
}

function envSpeakerMappingMode(name: string, fallback: "fixed" | "heuristic" | "raw"): "fixed" | "heuristic" | "raw" {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (raw === "fixed" || raw === "heuristic" || raw === "raw") return raw;
  return fallback;
}

function loadModelConfig(
  prefix: string,
  defaults: { key: string; modelPath: string; language: string },
): SttModelConfig {
  return {
    provider: envStr(`${prefix}_PROVIDER`, "local"),
    key: envStr(`${prefix}_MODEL`, defaults.key),
    repo: envStr(`${prefix}_MODEL_REPO`, ""),
    modelPath: envStr(`${prefix}_MODEL_PATH`, defaults.modelPath),
    device: envDevice(`${prefix}_DEVICE`, "auto"),
    language: envStr(`${prefix}_LANGUAGE`, defaults.language),
    enabled: envBool(`${prefix}_ENABLED`, true),
  };
}

// Compose paths via array join so Turbopack does not statically resolve them
// as project-relative directory references (and chase symlinks like .venv-stt).
function repoSubdir(...parts: string[]): string {
  return [process.cwd(), ...parts].join(path.sep);
}

export function loadSttConfig(): SttConfig {
  const fallbackOrderRaw = envStr(
    "STT_FALLBACK_ORDER",
    "faster-whisper-small",
  );
  const fallbackOrder = fallbackOrderRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    mock: envBool("MOCK_STT", false),
    showMockActions: envBool("SHOW_MOCK_ACTIONS", process.env.NODE_ENV === "development"),
    provider: envProvider("STT_PROVIDER", "local") as "local" | "sarvam" | "deepgram",
    pythonBin: envStr("STT_PYTHON_BIN", repoSubdir(".venv-stt", "bin", "python")),
    scriptDir: envStr("STT_SCRIPT_DIR", repoSubdir("stt")),
    runtimeDir: envStr("STT_RUNTIME_DIR", repoSubdir("runtime", "stt")),
    timeoutSeconds: envNum("STT_TIMEOUT_SECONDS", 420),
    localSttEnabled: envBool("LOCAL_STT_ENABLED", true),
    sarvam: {
      apiKey: envStr("SARVAM_API_KEY", ""),
      model: envStr("SARVAM_STT_MODEL", "saaras:v3"),
      mode: envStr("SARVAM_STT_MODE", "transcribe"),
      timeoutSeconds: envNum("SARVAM_TIMEOUT_SECONDS", 300),
      enableDiarization: envBool("SARVAM_ENABLE_DIARIZATION", true),
      useBatch: envBool("SARVAM_USE_BATCH", false),
      batchPollIntervalSeconds: envNum("SARVAM_BATCH_POLL_INTERVAL_SECONDS", 10),
      batchTimeoutSeconds: envNum("SARVAM_BATCH_TIMEOUT_SECONDS", 900),
      speakerMappingMode: envSpeakerMappingMode("SARVAM_SPEAKER_MAPPING_MODE", "heuristic"),
      mapSpeakersToAgentCustomer: envBool("SARVAM_MAP_SPEAKERS_TO_AGENT_CUSTOMER", true),
      firstSpeaker: envSpeaker("SARVAM_FIRST_SPEAKER", "agent"),
      secondSpeaker: envSpeaker("SARVAM_SECOND_SPEAKER", "customer"),
    },
    primary: loadModelConfig("STT_PRIMARY", {
      key: "indicconformer",
      modelPath: repoSubdir("models", "indicconformer-600m"),
      language: "hi",
    }),
    fallback1: loadModelConfig("STT_FALLBACK_1", {
      key: "faster-whisper-small",
      modelPath: repoSubdir("models", "faster-whisper-small"),
      language: "hi",
    }),
    fallback2: loadModelConfig("STT_FALLBACK_2", {
      key: "",
      modelPath: "",
      language: "hi",
    }),
    enableFallback: envBool("STT_ENABLE_FALLBACK", true),
    skipMissingModels: envBool("STT_SKIP_MISSING_MODELS", true),
    fallbackOrder,
    confidenceGood: envNum("STT_CONFIDENCE_THRESHOLD_GOOD", 0.75),
    confidenceFallback: envNum("STT_CONFIDENCE_THRESHOLD_FALLBACK", 0.5),
    chunkSeconds: envNum("STT_CHUNK_SECONDS", 15),
    chunkOverlapSeconds: envNum("STT_CHUNK_OVERLAP_SECONDS", 1),
    sampleRate: envNum("STT_SAMPLE_RATE", 16000),
  };
}

/** Looks up a model config by its key (primary/fallback1/fallback2). */
export function findModelByKey(config: SttConfig, key: string): SttModelConfig | null {
  for (const candidate of [config.primary, config.fallback1, config.fallback2]) {
    if (candidate.enabled && candidate.key && candidate.key.toLowerCase() === key.toLowerCase()) return candidate;
  }
  return null;
}

/** Returns the ordered list of models to try: primary, then resolved fallbacks. */
export function resolveModelChain(config: SttConfig): SttModelConfig[] {
  const chain: SttModelConfig[] = config.primary.enabled && config.primary.key ? [config.primary] : [];
  if (!config.enableFallback) return chain;
  for (const key of config.fallbackOrder) {
    const model = findModelByKey(config, key);
    if (model && !chain.some((m) => m.key === model.key)) {
      chain.push(model);
    }
  }
  return chain;
}
