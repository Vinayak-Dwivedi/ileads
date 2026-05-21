import { AsyncLocalStorage } from "node:async_hooks";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  traceId?: string;
  clientId?: string;
  userId?: string;
  callId?: string;
  route?: string;
  // Anything else feature-specific
  [key: string]: unknown;
}

const storage = new AsyncLocalStorage<LogContext>();

export function withLogContext<T>(ctx: LogContext, fn: () => Promise<T> | T): Promise<T> | T {
  const merged = { ...(storage.getStore() ?? {}), ...ctx };
  return storage.run(merged, fn);
}

export function getLogContext(): LogContext {
  return storage.getStore() ?? {};
}

function emit(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...getLogContext(),
    ...(extra ?? {}),
  };
  // stdout for info/debug, stderr for warn/error so PM2 splits them cleanly.
  const line = JSON.stringify(entry, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>) => emit("debug", msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => emit("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => emit("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => emit("error", msg, extra),
};

export function newTraceId(): string {
  return crypto.randomUUID();
}
