import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { saveAudioFile } from "@/lib/audio-storage";
import { probeAudioDurationSeconds } from "@/lib/audio-duration";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";

export const runtime = "nodejs";

const CUID_LIKE = /^[a-z0-9_-]{8,64}$/i;

const UploadMetadataSchema = z.object({
  clientId: z.string().regex(CUID_LIKE, "Invalid clientId"),
  campaignId: z.string().regex(CUID_LIKE).nullable(),
  teamId: z.string().regex(CUID_LIKE).nullable(),
  agentId: z.string().regex(CUID_LIKE).nullable(),
  customerNumber: z.string().max(64).nullable(),
  customerName: z.string().max(256).nullable(),
  callStartedAt: z.date(),
});

function value(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optionalValue(form: FormData, key: string): string | null {
  const v = value(form, key);
  return v || null;
}

function parseDateTime(input: string | null): Date {
  if (!input) return new Date();
  const parsed = new Date(input);
  return Number.isNaN(parsed.valueOf()) ? new Date() : parsed;
}

function buildExternalCallId(date: Date, index: number): string {
  const stamp = date
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replaceAll(".", "")
    .replaceAll("T", "")
    .replaceAll("Z", "")
    .slice(0, 14);
  const random = crypto.randomUUID().slice(0, 4).toUpperCase();
  return `CALL-${stamp}-${String(index + 1).padStart(2, "0")}-${random}`;
}

async function assertBelongsToClient(
  clientId: string,
  ids: { campaignId: string | null; teamId: string | null; agentId: string | null },
) {
  const [campaign, team, agent] = await Promise.all([
    ids.campaignId
      ? prisma.campaign.findFirst({ where: { id: ids.campaignId, clientId }, select: { id: true } })
      : Promise.resolve(null),
    ids.teamId
      ? prisma.team.findFirst({ where: { id: ids.teamId, clientId }, select: { id: true } })
      : Promise.resolve(null),
    ids.agentId
      ? prisma.agent.findFirst({ where: { id: ids.agentId, clientId }, select: { id: true, teamId: true } })
      : Promise.resolve(null),
  ]);

  if (ids.campaignId && !campaign) throw new Error("Selected campaign is not valid.");
  if (ids.teamId && !team) throw new Error("Selected team is not valid.");
  if (ids.agentId && !agent) throw new Error("Selected agent is not valid.");
}

export async function POST(request: Request) {
  try {
    const check = await requireRole("AGENT");
    if (!check.ok) return check.response;
    const session = check.session;
    const form = await request.formData();

    const meta = UploadMetadataSchema.safeParse({
      clientId: value(form, "clientId"),
      campaignId: optionalValue(form, "campaignId"),
      teamId: optionalValue(form, "teamId"),
      agentId: optionalValue(form, "agentId"),
      customerNumber: optionalValue(form, "customerNumber"),
      customerName: optionalValue(form, "customerName"),
      callStartedAt: parseDateTime(optionalValue(form, "callStartedAt")),
    });
    if (!meta.success) {
      return NextResponse.json(
        { error: "Invalid input.", details: meta.error.flatten() },
        { status: 400 },
      );
    }
    const { clientId, campaignId, teamId, agentId, customerNumber, customerName, callStartedAt } =
      meta.data;

    if (clientId !== session.clientId) {
      return NextResponse.json({ error: "Selected client is not valid." }, { status: 400 });
    }

    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "Select at least one audio file." }, { status: 400 });
    }

    await assertBelongsToClient(session.clientId, { campaignId, teamId, agentId });

    const created = [];
    for (const [index, file] of files.entries()) {
      const audio = await saveAudioFile(file);
      const durationSeconds = await probeAudioDurationSeconds(audio.audioPath);
      const call = await prisma.call.create({
        data: {
          clientId: session.clientId,
          campaignId,
          teamId,
          agentId,
          externalCallId: buildExternalCallId(callStartedAt, index),
          callerNumber: customerNumber,
          customerName,
          callStartedAt,
          durationSeconds,
          status: "UNKNOWN",
          disposition: null,
          sentiment: null,
          aiScore: null,
          manualScore: null,
          finalScore: null,
          originalFileName: audio.originalFileName,
          storedFileName: audio.storedFileName,
          audioPath: audio.audioPath,
          mimeType: audio.mimeType,
          fileSizeBytes: BigInt(audio.fileSizeBytes),
          events: {
            create: {
              eventType: "CALL_IMPORTED",
              title: "Call uploaded",
              description: audio.originalFileName,
              payload: {
                originalFileName: audio.originalFileName,
                storedFileName: audio.storedFileName,
                fileSizeBytes: audio.fileSizeBytes,
              },
            },
          },
        },
        select: { id: true, externalCallId: true },
      });
      created.push(call);
    }

    revalidatePath("/calls");
    revalidatePath("/dashboard");

    void writeAuditLog({
      action: "CALL_UPLOADED",
      entity: "Call",
      clientId: session.clientId,
      actorUserId: session.userId,
      actorClientAccessId: session.userId ? undefined : session.accessId,
      diff: { count: created.length, ids: created.map((c) => c.id) },
    });

    return NextResponse.json({ ok: true, count: created.length, calls: created });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: 400 },
    );
  }
}
