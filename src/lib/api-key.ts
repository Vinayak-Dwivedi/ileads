import "server-only";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { ApiError } from "@/server/api/errors";
import { API_KEY_PREFIX, generateApiKey, type GeneratedApiKey } from "@/lib/credentials";

// Re-export the pure crypto helper for backwards compatibility — earlier
// callers (Phase 3) imported generateApiKey from here. New CLI / non-server
// code should import directly from `@/lib/credentials`.
export { generateApiKey };
export type GeneratedKey = GeneratedApiKey;

const PREFIX_LEN = 8;

export interface VerifiedApiKey {
  id: string;
  clientId: string;
  prefix: string;
  scopes: string[];
  createdByUserId: string | null;
}

/** Parse + verify the Authorization header. Throws ApiError on any failure. */
export async function verifyApiKeyHeader(authHeader: string | null): Promise<VerifiedApiKey> {
  if (!authHeader) {
    throw new ApiError("UNAUTHORIZED", "Missing Authorization header.");
  }
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!m) {
    throw new ApiError("UNAUTHORIZED", "Expected `Authorization: Bearer <api-key>`.");
  }
  const token = m[1].trim();
  if (!token.startsWith(API_KEY_PREFIX)) {
    throw new ApiError("UNAUTHORIZED", "Invalid API key format.");
  }
  const tail = token.slice(API_KEY_PREFIX.length);
  const sep = tail.indexOf("_");
  if (sep !== PREFIX_LEN) {
    throw new ApiError("UNAUTHORIZED", "Invalid API key format.");
  }
  const prefix = tail.slice(0, PREFIX_LEN);
  const secret = tail.slice(PREFIX_LEN + 1);
  if (!prefix || !secret) {
    throw new ApiError("UNAUTHORIZED", "Invalid API key format.");
  }

  const row = await prisma.apiKey.findUnique({
    where: { prefix },
    select: {
      id: true,
      clientId: true,
      hashedSecret: true,
      scopes: true,
      expiresAt: true,
      isActive: true,
      createdByUserId: true,
      client: { select: { isActive: true } },
    },
  });
  if (!row || !row.isActive || !row.client.isActive) {
    throw new ApiError("UNAUTHORIZED", "API key not recognised.");
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    throw new ApiError("UNAUTHORIZED", "API key has expired.");
  }
  const ok = await bcrypt.compare(secret, row.hashedSecret);
  if (!ok) {
    throw new ApiError("UNAUTHORIZED", "API key not recognised.");
  }

  // Fire-and-forget lastUsedAt update — never block the request.
  void prisma.apiKey
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    id: row.id,
    clientId: row.clientId,
    prefix,
    scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
    createdByUserId: row.createdByUserId,
  };
}

export { API_KEY_PREFIX };
