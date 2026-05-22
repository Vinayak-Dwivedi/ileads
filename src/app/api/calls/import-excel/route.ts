import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseCallExcel, ExcelParseError, type ParsedCallRow } from "@/lib/excel-call-parser";
import { downloadAudioToStorage, AudioDownloadError } from "@/lib/audio-download";
import { probeAudioDurationSeconds } from "@/lib/audio-duration";
import { getConfig } from "@/lib/config";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit-log";
import { enqueueCallProcessing } from "@/lib/queue";
import { publishWebhookEvent } from "@/lib/webhooks";
import { assertQuotaAllows, trackQuotaUsage, QuotaExceededError } from "@/lib/quotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCEPTED_EXCEL_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream", // some browsers send this for .xlsx
  "text/csv",
  "text/plain",
  "application/csv",
  "text/comma-separated-values",
]);

const CUID_LIKE = /^[a-z0-9_-]{8,64}$/i;

const ImportRequestSchema = z.object({
  clientId: z.string().regex(CUID_LIKE, "Invalid clientId"),
});

interface ImportError {
  row: number;
  audioUrl?: string;
  message: string;
}

interface ImportedCall {
  id: string;
  externalCallId: string | null;
  row: number;
}

function getMaxRows(): number {
  return getConfig().EXCEL_IMPORT_MAX_ROWS;
}

function buildExternalCallId(date: Date, index: number): string {
  const stamp = date
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replaceAll(".", "")
    .replaceAll("T", "")
    .replaceAll("Z", "")
    .slice(2, 8);
  const random = crypto.randomUUID().slice(0, 4).toUpperCase();
  return `C${stamp}-${String(index + 1).padStart(2, "0")}-${random}`;
}

async function resolveAgentByCodeOrName(
  clientId: string,
  agentCode: string | null,
  agentName: string | null,
  cache: Map<string, string>,
): Promise<string | null> {
  if (!agentCode && !agentName) return null;
  const cacheKey = `${agentCode ?? ""}_${agentName ?? ""}`.toLowerCase();
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  // 1. Search by employeeCode
  if (agentCode) {
    const a = await prisma.agent.findFirst({
      where: { clientId, employeeCode: { equals: agentCode, mode: "insensitive" } },
      select: { id: true },
    });
    if (a) {
      cache.set(cacheKey, a.id);
      return a.id;
    }
  }

  // 2. Search by name
  if (agentName) {
    const a = await prisma.agent.findFirst({
      where: { clientId, name: { equals: agentName, mode: "insensitive" } },
      select: { id: true },
    });
    if (a) {
      cache.set(cacheKey, a.id);
      return a.id;
    }
  }

  // 3. Create Agent
  const nameToUse = agentName || agentCode || "Unknown Agent";
  const newAgent = await prisma.agent.create({
    data: {
      clientId,
      name: nameToUse,
      employeeCode: agentCode || null,
      isActive: true,
    },
    select: { id: true },
  });
  cache.set(cacheKey, newAgent.id);
  return newAgent.id;
}

async function resolveCampaign(
  clientId: string,
  campaignName: string | null,
  cache: Map<string, string>,
): Promise<string | null> {
  if (!campaignName) return null;
  const cacheKey = campaignName.toLowerCase();
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  const c = await prisma.campaign.findFirst({
    where: { clientId, name: { equals: campaignName, mode: "insensitive" } },
    select: { id: true },
  });
  if (c) {
    cache.set(cacheKey, c.id);
    return c.id;
  }

  // Create Campaign
  const newCampaign = await prisma.campaign.create({
    data: {
      clientId,
      name: campaignName,
      isActive: true,
    },
    select: { id: true },
  });
  cache.set(cacheKey, newCampaign.id);
  return newCampaign.id;
}

async function resolveTeam(
  clientId: string,
  teamName: string | null,
  cache: Map<string, string>,
): Promise<string | null> {
  if (!teamName) return null;
  const cacheKey = teamName.toLowerCase();
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  const t = await prisma.team.findFirst({
    where: { clientId, name: { equals: teamName, mode: "insensitive" } },
    select: { id: true },
  });
  if (t) {
    cache.set(cacheKey, t.id);
    return t.id;
  }

  // Create Team
  const newTeam = await prisma.team.create({
    data: {
      clientId,
      name: teamName,
    },
    select: { id: true },
  });
  cache.set(cacheKey, newTeam.id);
  return newTeam.id;
}

async function importRow(
  clientId: string,
  row: ParsedCallRow,
  index: number,
  caches: {
    agentCache: Map<string, string>;
    campaignCache: Map<string, string>;
    teamCache: Map<string, string>;
  },
): Promise<ImportedCall> {
  const callDate = row.callDate ?? new Date();
  const download = await downloadAudioToStorage(row.audioUrl, { date: callDate });

  let durationSeconds = row.durationSeconds;
  if (durationSeconds == null || durationSeconds <= 0) {
    try {
      durationSeconds = await probeAudioDurationSeconds(download.audioPath);
    } catch {
      durationSeconds = null;
    }
  }

  const [agentId, campaignId, teamId] = await Promise.all([
    resolveAgentByCodeOrName(clientId, row.agentCode, row.agentName, caches.agentCache),
    resolveCampaign(clientId, row.campaignName, caches.campaignCache),
    resolveTeam(clientId, row.teamName, caches.teamCache),
  ]);

  const externalCallId = row.externalCallId ?? buildExternalCallId(callDate, index);

  const call = await prisma.call.create({
    data: {
      clientId,
      campaignId,
      agentId,
      teamId,
      externalCallId,
      callerNumber: row.customerNumber,
      customerName: row.customerName,
      callStartedAt: callDate,
      durationSeconds,
      status: "UNKNOWN",
      disposition: row.disposition,
      language: row.language,
      sentiment: null,
      aiScore: null,
      manualScore: null,
      finalScore: null,
      originalFileName: download.originalFileName,
      storedFileName: download.storedFileName,
      audioPath: download.audioPath,
      mimeType: download.mimeType,
      fileSizeBytes: BigInt(download.fileSizeBytes),
      processingStatus: "uploaded",
      events: {
        create: {
          eventType: "CALL_IMPORTED",
          title: "Call imported from Excel",
          description: download.originalFileName,
          payload: {
            originalFileName: download.originalFileName,
            storedFileName: download.storedFileName,
            fileSizeBytes: download.fileSizeBytes,
            rowNumber: row.rowNumber,
          },
        },
      },
    },
    select: { id: true, externalCallId: true },
  });

  return { id: call.id, externalCallId: call.externalCallId, row: row.rowNumber };
}

export async function POST(request: Request) {
  try {
    const check = await requireRole("AGENT");
    if (!check.ok) return check.response;
    const session = check.session;
    const form = await request.formData();

    const meta = ImportRequestSchema.safeParse({
      clientId: String(form.get("clientId") ?? "").trim(),
    });
    if (!meta.success) {
      return NextResponse.json(
        { error: "Invalid input.", details: meta.error.flatten() },
        { status: 400 },
      );
    }
    const { clientId } = meta.data;

    if (clientId !== session.clientId) {
      return NextResponse.json({ error: "Selected client is not valid." }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Excel file is required." }, { status: 400 });
    }
    if (file.type && !ACCEPTED_EXCEL_MIME.has(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}` },
        { status: 400 },
      );
    }
    const maxRows = getMaxRows();
    const maxBytes = getConfig().MAX_AUDIO_UPLOAD_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      return NextResponse.json(
        { error: `Excel file exceeds ${getConfig().MAX_AUDIO_UPLOAD_MB} MB limit.` },
        { status: 400 },
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());

    let parsed;
    try {
      parsed = parseCallExcel(buffer);
    } catch (e) {
      const msg = e instanceof ExcelParseError ? e.message : "Could not parse Excel file.";
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    if (parsed.rows.length === 0) {
      return NextResponse.json(
        {
          error: "No rows with an audio URL were found.",
          totalRows: parsed.totalRows,
          errors: parsed.errors,
        },
        { status: 400 },
      );
    }
    if (parsed.rows.length > maxRows) {
      return NextResponse.json(
        { error: `Excel has ${parsed.rows.length} valid rows, exceeds limit of ${maxRows}.` },
        { status: 400 },
      );
    }

    // Hard-quota pre-check for the whole batch so we don't half-import.
    await assertQuotaAllows(clientId, "CALLS_PER_DAY", parsed.rows.length);

    const imported: ImportedCall[] = [];
    const errors: ImportError[] = parsed.errors.map((e) => ({ row: e.row, message: e.message }));
    let skipped = errors.length;
    let failed = 0;

    const agentCache = new Map<string, string>();
    const campaignCache = new Map<string, string>();
    const teamCache = new Map<string, string>();

    for (let i = 0; i < parsed.rows.length; i += 1) {
      const row = parsed.rows[i];
      try {
        const r = await importRow(clientId, row, i, { agentCache, campaignCache, teamCache });
        imported.push(r);
        void enqueueCallProcessing({ callId: r.id, clientId });
        void publishWebhookEvent(clientId, "call.imported", {
          callId: r.id,
          externalCallId: r.externalCallId,
          source: "excel",
          row: r.row,
        });
        void trackQuotaUsage(clientId, "CALLS_PER_DAY");
      } catch (e) {
        failed += 1;
        const message =
          e instanceof AudioDownloadError
            ? `[${e.code}] ${e.message}`
            : e instanceof Error
              ? e.message
              : "Import failed.";
        errors.push({ row: row.rowNumber, message });
      }
    }

    revalidatePath("/calls");
    revalidatePath("/dashboard");

    void writeAuditLog({
      action: "CALL_IMPORTED_BULK",
      entity: "Call",
      clientId: session.clientId,
      actorUserId: session.userId,
      actorClientAccessId: session.userId ? undefined : session.accessId,
      diff: {
        imported: imported.length,
        skipped,
        failed,
        totalRows: parsed.totalRows,
      },
    });

    return NextResponse.json({
      ok: true,
      imported: imported.length,
      skipped,
      failed,
      totalRows: parsed.totalRows,
      calls: imported,
      errors,
    });
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          kind: error.kind,
          limit: error.limit,
          currentCount: error.currentCount,
        },
        {
          status: 429,
          headers: { "Retry-After": String(error.retryAfterSeconds) },
        },
      );
    }
    const status = error instanceof Error && /unauthor/i.test(error.message) ? 401 : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Excel import failed." },
      { status },
    );
  }
}
