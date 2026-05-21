// Provision a webhook subscription. Run with:
//   npm run webhook:create -- --client <clientId> --url https://example.com/webhook \
//     --label "CRM sync" --events call.audit.completed,call.transcript.ready
//
// Use --events "*" to subscribe to everything. The HMAC secret is printed
// ONCE and never recoverable; store it in the consumer's config so they can
// verify the X-QMS-Signature header.

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { generateWebhookSecret } from "../src/lib/credentials";
import { WEBHOOK_EVENTS } from "../src/lib/webhooks";

interface Args {
  client: string;
  url: string;
  label: string;
  events: string[];
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
    url: out.url,
    label: out.label,
    events: out.events
      ? out.events.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined,
    createdByUserId: out["created-by"],
  };
}

async function main() {
  const args = parseFlags(process.argv.slice(2));
  const missing = ["client", "url", "label"].filter((k) => !args[k as keyof Args]);
  if (missing.length) {
    console.error(`Missing required: ${missing.join(", ")}`);
    process.exit(2);
  }
  const events = args.events ?? ["*"];
  const knownEvents = new Set<string>(WEBHOOK_EVENTS);
  const unknown = events.filter((e) => e !== "*" && !knownEvents.has(e));
  if (unknown.length) {
    console.error(`Unknown event(s): ${unknown.join(", ")}.`);
    console.error(`Known events: ${[...WEBHOOK_EVENTS, "*"].join(", ")}`);
    process.exit(2);
  }

  try {
    new URL(args.url!);
  } catch {
    console.error(`Invalid URL: ${args.url}`);
    process.exit(2);
  }

  const client = await prisma.client.findUnique({ where: { id: args.client! } });
  if (!client) {
    console.error(`No client with id ${args.client}`);
    process.exit(3);
  }

  const secret = generateWebhookSecret();

  const created = await prisma.webhook.create({
    data: {
      clientId: args.client!,
      url: args.url!,
      label: args.label!,
      events: events as unknown as object,
      secret,
      createdByUserId: args.createdByUserId ?? null,
      isActive: true,
    },
    select: { id: true, url: true, label: true, events: true },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        webhook: created,
        // Show the secret ONCE. Store it on the consumer side.
        secret,
        signatureHeader:
          "X-QMS-Signature (format: sha256=<hex of HMAC-SHA256 over `${deliveryId}.${timestamp}.${body}`>)",
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
