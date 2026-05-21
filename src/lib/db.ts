import { PrismaClient } from "@prisma/client";

// Build a DATABASE_URL with pool params appended. Reads from raw process.env
// (not the Zod config) so this stays importable from scripts that don't load
// the full server-only config (e.g. queue worker, migration helpers).
function buildDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  const poolSize = process.env.DATABASE_POOL_SIZE;
  const connectTimeout = process.env.DATABASE_CONNECTION_TIMEOUT_SECONDS;
  if (!poolSize && !connectTimeout) return raw;
  try {
    const url = new URL(raw);
    if (poolSize && !url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", poolSize);
    }
    if (connectTimeout && !url.searchParams.has("connect_timeout")) {
      url.searchParams.set("connect_timeout", connectTimeout);
    }
    return url.toString();
  } catch {
    return raw;
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    datasources: {
      db: { url: buildDatabaseUrl() ?? "" },
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
