import "server-only";
import type { SttConfig, SttModelConfig } from "./config";
import type { SttEngine } from "./types";

// Plug-in registry for STT engines. Built-in engines (mock, sarvam, python)
// self-register on module load. Adding a new provider (e.g. Deepgram,
// Whisper.cpp) is a new file that calls registerSttEngine(name, factory).
//
// `factory` receives the loaded SttConfig and an optional per-model config
// (used by the python engine to differentiate primary / fallback models).

export type SttEngineFactory = (args: {
  config: SttConfig;
  modelConfig?: SttModelConfig;
}) => SttEngine;

const registry = new Map<string, SttEngineFactory>();

export function registerSttEngine(name: string, factory: SttEngineFactory): void {
  if (registry.has(name)) {
    // Allow re-registration in dev (HMR) — last one wins.
    if (process.env.NODE_ENV !== "production") {
      registry.set(name, factory);
      return;
    }
    throw new Error(`STT engine already registered: ${name}`);
  }
  registry.set(name, factory);
}

export function getSttEngineFactory(name: string): SttEngineFactory | undefined {
  return registry.get(name);
}

export function listRegisteredSttEngines(): string[] {
  return [...registry.keys()];
}

export function buildSttEngine(
  name: string,
  args: { config: SttConfig; modelConfig?: SttModelConfig },
): SttEngine | null {
  const factory = registry.get(name);
  if (!factory) return null;
  return factory(args);
}
