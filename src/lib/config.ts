import "server-only";
import { z } from "zod";

const PLACEHOLDER_SECRETS = new Set([
  "super-secret-random-key-at-least-32-chars-long-and-secure",
  "change-me",
  "secret",
]);

// dotenv keeps empty values as "" rather than dropping them, so a key like
// `DATABASE_REPLICA_URL=""` in .env arrives as "" — which `.url()` rejects.
// Treat blank-or-whitespace as "unset" for optional URL fields.
const optionalUrl = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().url().optional(),
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().url(),
  // Optional read-replica URL for read-heavy aggregates (dashboards, list
  // endpoints). When unset, reads hit the primary.
  DATABASE_REPLICA_URL: optionalUrl,
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_BASE_PATH: z.string().default(""),

  APP_SECRET: z
    .string()
    .min(32, "APP_SECRET must be at least 32 characters")
    .refine((v) => !PLACEHOLDER_SECRETS.has(v), "APP_SECRET is a placeholder value — generate a real one"),

  // Legacy single-password login. Kept for back-compat; will be removed in Phase 1
  // once per-user auth lands. NOT validated as a secret here because dev/test
  // installs reasonably use simple values.
  APP_PASSWORD: z.string().optional(),

  // Storage
  AUDIO_STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  AUDIO_STORAGE_PATH: z.string().default("./storage/audio"),
  MAX_AUDIO_UPLOAD_MB: z.coerce.number().int().positive().default(100),
  AUDIO_DOWNLOAD_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  AUDIO_DOWNLOAD_PRIVATE_HOST_ALLOWLIST: z.string().default(""),

  // S3-compatible storage (only required when AUDIO_STORAGE_PROVIDER=s3)
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ENDPOINT: optionalUrl,
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  S3_PUBLIC_BASE_URL: optionalUrl,

  // BullMQ / Redis (queue is in-process when REDIS_URL missing)
  REDIS_URL: z.string().optional(),
  QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(2),

  // /api/v1/* rate-limit (per API key)
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60 * 1000),

  // Excel import
  EXCEL_IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(500),

  // STT
  STT_PROVIDER: z.enum(["sarvam", "assemblyai", "local", "deepgram"]).default("sarvam"),
  MOCK_STT: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  STT_PYTHON_BIN: z.string().optional(),
  SARVAM_API_KEY: z.string().optional(),
  SARVAM_USE_BATCH: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  SARVAM_BATCH_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(10),
  ASSEMBLYAI_API_KEY: z.string().optional(),
  DEEPGRAM_API_KEY: z.string().optional(),
  DEEPGRAM_MODEL: z.string().default("nova-2"),
  DEEPGRAM_LANGUAGE: z.string().default("multi"),

  // LLM / Audit
  AUDIT_PROVIDER: z.enum(["openrouter", "gemini"]).default("openrouter"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_AUDIT_MODEL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_AUDIT_MODEL: z.string().optional(),
  GEMINI_BASE_URL: z.string().optional(),

  // UI flags
  SHOW_MOCK_ACTIONS: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  // Auth rate-limiting
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),

  // Observability (Sentry no-ops when DSN missing)
  SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  SENTRY_PROFILES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

  // Database connection pool
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),
  DATABASE_CONNECTION_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(10),
});

export type AppConfig = z.infer<typeof EnvSchema>;

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

// Eagerly validate at module load so misconfigured deployments fail fast
// instead of surfacing errors on the first request that needs a missing key.
getConfig();
