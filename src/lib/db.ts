import { PrismaClient } from "@prisma/client";

// Append pool params from env onto a base DATABASE_URL. Used for both the
// primary and replica clients so pool tuning applies uniformly.
function withPoolParams(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  const poolSize = process.env.DATABASE_POOL_SIZE;
  const connectTimeout = process.env.DATABASE_CONNECTION_TIMEOUT_SECONDS;
  if (!poolSize && !connectTimeout) return rawUrl;
  try {
    const url = new URL(rawUrl);
    if (poolSize && !url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", poolSize);
    }
    if (connectTimeout && !url.searchParams.has("connect_timeout")) {
      url.searchParams.set("connect_timeout", connectTimeout);
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function buildClient(url: string | undefined): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    datasources: { db: { url: url ?? "" } },
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaRead: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ?? buildClient(withPoolParams(process.env.DATABASE_URL));

// Read-only client. When DATABASE_REPLICA_URL is set, this is a separate
// PrismaClient pointed at the read replica — use for read-heavy aggregates
// (dashboards, list endpoints) so the primary stays free for writes.
//
// CAVEAT: replication is asynchronous. Avoid prismaRead for "read what I
// just wrote" flows (e.g. fetching a Call by id immediately after create) —
// use the primary `prisma` for those.
//
// When the env var is missing, prismaRead === prisma so existing call sites
// keep working.
export const prismaRead =
  globalForPrisma.prismaRead ??
  (process.env.DATABASE_REPLICA_URL
    ? buildClient(withPoolParams(process.env.DATABASE_REPLICA_URL))
    : prisma);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaRead = prismaRead;
}
