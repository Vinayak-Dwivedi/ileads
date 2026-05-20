import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseCallExcel, ExcelParseError, type ParsedCallRow } from "@/lib/excel-call-parser";
import { downloadAudioToStorage, AudioDownloadError } from "@/lib/audio-download";
import { probeAudioDurationSeconds } from "@/lib/audio-duration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const v = Number(process.env.EXCEL_IMPORT_MAX_ROWS ?? "500");
  return Number.isFinite(v) && v > 0 ? v : 500;
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

async function resolveAgentByCodeOrName(
  clientId: string,
  agentCode: string | null,
  agentName: string | null,
): Promise<string | null> {
  if (!agentCode && !agentName) return null;
  if (agentCode) {
    const a = await prisma.agent.findFirst({
      where: { clientId, employeeCode: { equals: agentCode, mode: "insensitive" } },
      select: { id: true },
    });
    if (a) return a.id;
  }
  if (agentName) {
    const a = await prisma.agent.findFirst({
      where: { clientId, name: { equals: agentName, mode: "insensitive" } },
      select: { id: true },
    });
    if (a) return a.id;
  }
  return null;
}

async function resolveCampaign(
  clientId: string,
  campaignName: string | null,
): Promise<string | null> {
  if (!campaignName) return null;
  const c = await prisma.campaign.findFirst({
    where: { clientId, name: { equals: campaignName, mode: "insensitive" } },
    select: { id: true },
  });
  return c?.id ?? null;
}

async function resolveTeam(
  clientId: string,
  teamName: string | null,
): Promise<string | null> {
  if (!teamName) return null;
  const t = await prisma.team.findFirst({
    where: { clientId, name: { equals: teamName, mode: "insensitive" } },
    select: { id: true },
  });
  return t?.id ?? null;
}

async function importRow(
  clientId: string,
  row: ParsedCallRow,
  index: number,
): Promise<ImportedCall> {
  const callDate = row.callDate ?? new Date();
  const download = await downloadAudioToStorage(row.audioUrl, { date: callDate });
  const durationSeconds = await probeAudioDurationSeconds(download.audioPath);

  const [agentId, campaignId, teamId] = await Promise.all([
    resolveAgentByCodeOrName(clientId, row.agentCode, row.agentName),
    resolveCampaign(clientId, row.campaignName),
    resolveTeam(clientId, row.teamName),
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
    const session = await requireSession();
    const form = await request.formData();
    const clientId = String(form.get("clientId") ?? "").trim();
    if (clientId !== session.clientId) {
      return NextResponse.json({ error: "Selected client is not valid." }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Excel file is required." }, { status: 400 });
    }

    const maxRows = getMaxRows();
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

    const imported: ImportedCall[] = [];
    const errors: ImportError[] = parsed.errors.map((e) => ({ row: e.row, message: e.message }));
    let skipped = errors.length;
    let failed = 0;

    for (let i = 0; i < parsed.rows.length; i += 1) {
      const row = parsed.rows[i];
      try {
        const r = await importRow(clientId, row, i);
        imported.push(r);
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
    const status = error instanceof Error && /unauthor/i.test(error.message) ? 401 : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Excel import failed." },
      { status },
    );
  }
}
