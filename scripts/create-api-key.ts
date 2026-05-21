// Provision an API key for /api/v1/*. Run with:
//   npm run apikey:create -- --client <clientId> --label "Beetel integration" \
//     --scopes calls:read,calls:write [--expires-days 365] [--created-by <userId>]
//
// The plaintext key is printed ONCE and never recoverable. Store it securely
// (vault, password manager, the consumer's secret store).

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { generateApiKey } from "../src/lib/api-key";

interface Args {
  client: string;
  label: string;
  scopes: string[];
  expiresDays?: number;
  createdByUserId?: string;
}

function parseFlags(argv: string[]): Partial<Args> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v && !v.startsWith("--")) {
      out[k] = v;
      i += 1;
    }
  }
  return {
    client: out.client ?? out.clientId,
    label: out.label,
    scopes: out.scopes
      ? out.scopes.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined,
    expiresDays: out["expires-days"] ? Number(out["expires-days"]) : undefined,
    createdByUserId: out["created-by"],
  };
}

async function main() {
  const args = parseFlags(process.argv.slice(2));
  const missing = ["client", "label"].filter((k) => !args[k as keyof Args]);
  if (missing.length) {
    console.error(`Missing required: ${missing.join(", ")}`);
    process.exit(2);
  }
  const scopes = args.scopes ?? ["calls:read"];

  const client = await prisma.client.findUnique({ where: { id: args.client! } });
  if (!client) {
    console.error(`No client with id ${args.client}`);
    process.exit(3);
  }

  const { plaintext, prefix, hashedSecret } = await generateApiKey();
  const expiresAt =
    args.expiresDays && args.expiresDays > 0
      ? new Date(Date.now() + args.expiresDays * 24 * 3600 * 1000)
      : null;

  const created = await prisma.apiKey.create({
    data: {
      clientId: args.client!,
      label: args.label!,
      prefix,
      hashedSecret,
      scopes: scopes as unknown as object,
      expiresAt,
      createdByUserId: args.createdByUserId ?? null,
      isActive: true,
    },
    select: { id: true, prefix: true, scopes: true, expiresAt: true },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        apiKey: created,
        // Show the plaintext ONCE. The DB only stores the bcrypt hash.
        plaintextKey: plaintext,
        usage: `Authorization: Bearer ${plaintext}`,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
