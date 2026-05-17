import "server-only";

/**
 * Minimal OpenRouter chat-completions client used by the live AI audit.
 *
 * Design constraints:
 *   - No audio is ever sent — only text (prompt with metadata + transcript).
 *   - API key is read from process.env at call time. Never logged, never
 *     returned. If missing we surface code "OPENROUTER_API_KEY_MISSING".
 *   - Retries transient failures (HTTP 429 / 5xx, AbortError, fetch errors).
 *   - Parses JSON safely even if the model wraps the object in markdown
 *     fences or surrounding prose.
 */

export interface OpenRouterConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** OpenRouter-native fallback chain — populated when the primary upstream is rate-limited. */
  fallbackModels: string[];
  timeoutMs: number;
  httpReferer: string | null;
  appTitle: string | null;
}

export interface OpenRouterUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface OpenRouterChatResult<T = unknown> {
  ok: true;
  model: string;
  content: string;
  parsed: T | null;
  usage: OpenRouterUsage | null;
  rawResponse: unknown;
  attempts: number;
}

export interface OpenRouterChatError {
  ok: false;
  code:
    | "OPENROUTER_API_KEY_MISSING"
    | "OPENROUTER_HTTP_ERROR"
    | "OPENROUTER_TIMEOUT"
    | "OPENROUTER_NETWORK"
    | "OPENROUTER_EMPTY_RESPONSE"
    | "OPENROUTER_INVALID_JSON";
  message: string;
  status?: number;
  attempts: number;
  rawResponse?: unknown;
  content?: string;
}

export type OpenRouterChatOutcome<T = unknown> =
  | OpenRouterChatResult<T>
  | OpenRouterChatError;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Force JSON-mode if the model honours response_format. */
  requestJson?: boolean;
  /** Override the global retry count. Default: 2 retries (3 attempts). */
  maxRetries?: number;
}

function envStr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.trim().length > 0 ? raw.trim() : fallback;
}

function envNum(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadOpenRouterConfig(): OpenRouterConfig {
  const timeoutSeconds = envNum("OPENROUTER_TIMEOUT_SECONDS", 180);
  const fallbackRaw = process.env.OPENROUTER_AUDIT_FALLBACK_MODELS ?? "";
  const fallbackModels = fallbackRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    apiKey: process.env.OPENROUTER_API_KEY?.trim() ?? "",
    baseUrl: envStr("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
    model: envStr("OPENROUTER_AUDIT_MODEL", "google/gemma-4-31b-it:free"),
    fallbackModels,
    timeoutMs: Math.max(1000, Math.floor(timeoutSeconds * 1000)),
    httpReferer: process.env.OPENROUTER_HTTP_REFERER?.trim() || null,
    appTitle: process.env.OPENROUTER_APP_TITLE?.trim() || null,
  };
}

export function hasOpenRouterKey(config: OpenRouterConfig = loadOpenRouterConfig()): boolean {
  return config.apiKey.length > 0;
}

/**
 * Extract the first balanced JSON object from a string. Tolerates markdown
 * fences (```json ... ```) and leading/trailing prose.
 *
 * Returns null if no JSON object can be located.
 */
export function extractJsonObject<T = unknown>(text: string): T | null {
  if (!text) return null;
  const trimmed = text.trim();

  // Try a direct parse first.
  try {
    const direct = JSON.parse(trimmed);
    if (direct && typeof direct === "object") return direct as T;
  } catch {
    // Fall through to fenced/embedded extraction.
  }

  // Strip ```json fences if present.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    const inside = fenceMatch[1].trim();
    try {
      const parsed = JSON.parse(inside);
      if (parsed && typeof parsed === "object") return parsed as T;
    } catch {
      // continue
    }
  }

  // Scan for first balanced { ... } block (handles strings/escapes).
  const start = trimmed.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = trimmed.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === "object") return parsed as T;
        } catch {
          return null;
        }
        return null;
      }
    }
  }
  return null;
}

function pickContent(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const choices = (raw as { choices?: unknown[] }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  if (typeof content === "string") return content;
  // Some providers return content as an array of parts.
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
      .filter(Boolean)
      .join("");
  }
  return "";
}

function pickUsage(raw: unknown): OpenRouterUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = (raw as { usage?: Record<string, unknown> }).usage;
  if (!u || typeof u !== "object") return null;
  const out: OpenRouterUsage = {};
  if (typeof u.prompt_tokens === "number") out.promptTokens = u.prompt_tokens;
  if (typeof u.completion_tokens === "number") out.completionTokens = u.completion_tokens;
  if (typeof u.total_tokens === "number") out.totalTokens = u.total_tokens;
  return Object.keys(out).length > 0 ? out : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a chat completion against OpenRouter.
 *
 * Does NOT throw on network/HTTP errors — returns an OpenRouterChatError
 * the caller can surface to the UI / DB.
 */
export async function openrouterChat<T = unknown>(
  options: ChatOptions,
  configOverride?: OpenRouterConfig,
): Promise<OpenRouterChatOutcome<T>> {
  const config = configOverride ?? loadOpenRouterConfig();

  if (!config.apiKey) {
    return {
      ok: false,
      code: "OPENROUTER_API_KEY_MISSING",
      message:
        "OpenRouter API key missing. Add OPENROUTER_API_KEY to .env and restart PM2.",
      attempts: 0,
    };
  }

  const maxRetries = Math.max(0, options.maxRetries ?? 4);
  const url = `${config.baseUrl}/chat/completions`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };
  if (config.httpReferer) headers["HTTP-Referer"] = config.httpReferer;
  if (config.appTitle) headers["X-Title"] = config.appTitle;

  const body: Record<string, unknown> = {
    model: config.model,
    messages: options.messages,
  };
  if (config.fallbackModels.length > 0) {
    // OpenRouter-native fallback: if the primary is upstream-429 or
    // unavailable, it auto-routes to the next entry without raising.
    body.models = [config.model, ...config.fallbackModels];
  }
  if (typeof options.temperature === "number") body.temperature = options.temperature;
  if (typeof options.maxTokens === "number") body.max_tokens = options.maxTokens;
  if (options.requestJson) body.response_format = { type: "json_object" };

  let lastError: OpenRouterChatError | null = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const status = response.status;
      const text = await response.text();
      let rawJson: unknown = null;
      try {
        rawJson = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        rawJson = text;
      }

      if (!response.ok) {
        // Retry on 429 / 5xx; fail fast on 4xx (except 408/429).
        const retryable = status === 408 || status === 429 || (status >= 500 && status < 600);
        lastError = {
          ok: false,
          code: "OPENROUTER_HTTP_ERROR",
          message: `OpenRouter HTTP ${status}: ${truncate(text, 400)}`,
          status,
          attempts: attempt,
          rawResponse: rawJson,
        };
        if (!retryable || attempt > maxRetries) return lastError;
        await sleep(backoffMs(attempt, status === 429));
        continue;
      }

      const content = pickContent(rawJson);
      if (!content) {
        lastError = {
          ok: false,
          code: "OPENROUTER_EMPTY_RESPONSE",
          message: "OpenRouter returned no content.",
          attempts: attempt,
          rawResponse: rawJson,
        };
        if (attempt > maxRetries) return lastError;
        await sleep(backoffMs(attempt));
        continue;
      }

      const parsed = extractJsonObject<T>(content);
      const usage = pickUsage(rawJson);
      const modelEcho =
        (rawJson && typeof rawJson === "object" && typeof (rawJson as { model?: unknown }).model === "string"
          ? (rawJson as { model: string }).model
          : config.model) || config.model;

      return {
        ok: true,
        model: modelEcho,
        content,
        parsed,
        usage,
        rawResponse: rawJson,
        attempts: attempt,
      };
    } catch (err) {
      clearTimeout(timeout);
      const isAbort = err instanceof Error && err.name === "AbortError";
      lastError = {
        ok: false,
        code: isAbort ? "OPENROUTER_TIMEOUT" : "OPENROUTER_NETWORK",
        message: isAbort
          ? `OpenRouter request timed out after ${Math.round(config.timeoutMs / 1000)}s.`
          : `OpenRouter network error: ${err instanceof Error ? err.message : String(err)}`,
        attempts: attempt,
      };
      if (attempt > maxRetries) return lastError;
      await sleep(backoffMs(attempt));
    }
  }

  return (
    lastError ?? {
      ok: false,
      code: "OPENROUTER_NETWORK",
      message: "OpenRouter call failed with no recorded error.",
      attempts: maxRetries + 1,
    }
  );
}

function backoffMs(attempt: number, longer = false): number {
  // Normal: 500ms, 1500ms, 4500ms ...
  // 429-longer: 3s, 8s, 18s, 30s, 30s ...  — upstream RPM/TPM limits on
  // free Gemma can take 30–60s to clear; the larger waits at the tail
  // let us ride out a per-minute window without hammering the provider.
  if (longer) {
    const seq = [3000, 8000, 18000, 30000];
    return seq[Math.min(attempt - 1, seq.length - 1)] ?? 30000;
  }
  return Math.min(4500, 500 * Math.pow(3, attempt - 1));
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}
