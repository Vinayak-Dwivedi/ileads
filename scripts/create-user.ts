// Provision a per-user login. Run with:
//   npm run user:create -- --client <clientId> --email <email> --password <pw> --role <OWNER|AUDITOR|AGENT|VIEWER> [--name <name>]
// or pipe a JSON object on stdin: { "clientId", "email", "password", "role", "name" }.

import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";

type Role = "OWNER" | "AUDITOR" | "AGENT" | "VIEWER";
const ROLES = new Set<Role>(["OWNER", "AUDITOR", "AGENT", "VIEWER"]);

interface Args {
  clientId: string;
  email: string;
  password: string;
  role: Role;
  name?: string;
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
    clientId: out.client ?? out.clientId,
    email: out.email,
    password: out.password,
    role: (out.role as Role | undefined) ?? "VIEWER",
    name: out.name,
  };
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (buf += chunk));
    process.stdin.on("end", () => resolve(buf));
  });
}

async function main() {
  const flagArgs = parseFlags(process.argv.slice(2));
  const stdinRaw = await readStdin();
  const stdinArgs = stdinRaw.trim() ? (JSON.parse(stdinRaw) as Partial<Args>) : {};
  const args: Partial<Args> = { ...stdinArgs, ...flagArgs };

  const missing = ["clientId", "email", "password"].filter((k) => !args[k as keyof Args]);
  if (missing.length) {
    console.error(`Missing required: ${missing.join(", ")}`);
    process.exit(2);
  }
  if (!args.role || !ROLES.has(args.role)) {
    console.error(`Invalid role. Must be one of: ${[...ROLES].join(", ")}`);
    process.exit(2);
  }
  if (args.password!.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(2);
  }

  const client = await prisma.client.findUnique({ where: { id: args.clientId! } });
  if (!client) {
    console.error(`No client with id ${args.clientId}`);
    process.exit(3);
  }

  const passwordHash = await bcrypt.hash(args.password!, 12);

  const user = await prisma.user.upsert({
    where: { clientId_email: { clientId: args.clientId!, email: args.email!.toLowerCase() } },
    create: {
      clientId: args.clientId!,
      email: args.email!.toLowerCase(),
      passwordHash,
      role: args.role!,
      name: args.name ?? null,
      isActive: true,
    },
    update: {
      passwordHash,
      role: args.role!,
      name: args.name ?? undefined,
      isActive: true,
    },
    select: { id: true, email: true, role: true, clientId: true },
  });

  console.log(JSON.stringify({ ok: true, user }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
