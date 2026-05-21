import "server-only";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { ApiError } from "@/server/api/errors";

const KEY_PREFIX = "qms_live_";
const PREFIX_LEN = 8;
const SECRET_LEN = 32;

export interface GeneratedKey {
  // The full plaintext key (qms_live_<prefix>_<secret>). Shown to the caller
  // ONCE at creation; never recoverable afterwards.
  plaintext: string;
  // The 8-character lookup prefix stored unhashed in the DB.
  prefix: string;
  // The bcrypt hash of the secret half.
  hashedSecret: string;
}

function randomBase62(length: number): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const buf = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += chars[buf[i] % chars.length];
  return out;
}

/** Mint a new API key. Hash + prefix go to DB; plaintext goes to the user. */
export async function generateApiKey(): Promise<GeneratedKey> {
  const prefix = randomBase62(PREFIX_LEN);
  const secret = randomBase62(SECRET_LEN);
  const plaintext = `${KEY_PREFIX}${prefix}_${secret}`;
  const hashedSecret = await bcrypt.hash(secret, 12);
  return { plaintext, prefix, hashedSecret };
}

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
  if (!token.startsWith(KEY_PREFIX)) {
    throw new ApiError("UNAUTHORIZED", "Invalid API key format.");
  }
  const tail = token.slice(KEY_PREFIX.length);
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

export const API_KEY_PREFIX = KEY_PREFIX;
