// Pure crypto helpers for generating API keys and webhook secrets.
// Kept free of the `server-only` marker so CLI scripts (scripts/*.ts) can
// import them — the verification side (which touches Prisma) still lives in
// api-key.ts / webhooks.ts behind the server-only guard.

import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

export const API_KEY_PREFIX = "qms_live_";
const API_PREFIX_LEN = 8;
const API_SECRET_LEN = 32;

export interface GeneratedApiKey {
  // Full plaintext key (qms_live_<prefix>_<secret>). Shown once at creation.
  plaintext: string;
  // 8-character lookup prefix stored unhashed.
  prefix: string;
  // bcrypt hash of the secret half.
  hashedSecret: string;
}

function randomBase62(length: number): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const buf = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += chars[buf[i] % chars.length];
  return out;
}

export async function generateApiKey(): Promise<GeneratedApiKey> {
  const prefix = randomBase62(API_PREFIX_LEN);
  const secret = randomBase62(API_SECRET_LEN);
  const plaintext = `${API_KEY_PREFIX}${prefix}_${secret}`;
  const hashedSecret = await bcrypt.hash(secret, 12);
  return { plaintext, prefix, hashedSecret };
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}
