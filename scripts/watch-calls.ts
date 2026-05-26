import { prisma } from "../src/lib/db";

const seen = new Map<string, string>();

async function tick() {
  const calls = await prisma.call.findMany({
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: {
      id: true,
      externalCallId: true,
      processingStatus: true,
      processingError: true,
      aiScore: true,
      transcript: { select: { id: true } },
      _count: { select: { aiAudits: true } },
    },
  });
  for (const c of calls) {
    const fingerprint = `${c.processingStatus}|tx=${c.transcript ? 1 : 0}|au=${c._count.aiAudits}|score=${c.aiScore ?? "-"}|err=${(c.processingError ?? "").slice(0, 80)}`;
    if (seen.get(c.id) === fingerprint) continue;
    seen.set(c.id, fingerprint);
    const label = c.externalCallId ?? c.id.slice(-8);
    process.stdout.write(
      `[${new Date().toISOString().slice(11, 19)}] ${label}  status=${c.processingStatus}  transcript=${c.transcript ? "yes" : "no"}  audits=${c._count.aiAudits}  score=${c.aiScore ?? "-"}` +
      (c.processingError ? `  ERR=${c.processingError.slice(0, 120).replace(/\n/g, " ")}` : "") +
      "\n",
    );
  }
}

async function main() {
  process.stdout.write(`[${new Date().toISOString().slice(11, 19)}] Watching last 40 calls by updatedAt...\n`);
  await tick();
  while (true) {
    try { await tick(); } catch (e) { process.stdout.write(`ERR ${e instanceof Error ? e.message : String(e)}\n`); }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

main().finally(() => prisma.$disconnect());
