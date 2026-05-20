import "server-only";
import * as XLSX from "xlsx";

export interface ParsedCallRow {
  rowNumber: number;
  audioUrl: string;
  externalCallId: string | null;
  callDate: Date | null;
  agentCode: string | null;
  agentName: string | null;
  customerName: string | null;
  customerNumber: string | null;
  campaignName: string | null;
  teamName: string | null;
  disposition: string | null;
  language: string | null;
  durationSeconds: number | null;
}

export interface ParseResult {
  rows: ParsedCallRow[];
  errors: { row: number; message: string }[];
  totalRows: number;
}

export class ExcelParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExcelParseError";
  }
}

const AUDIO_URL_KEYS = [
  "audio_url",
  "audio link",
  "audio_link",
  "audiolink",
  "audio",
  "recording_url",
  "recording link",
  "recording_link",
  "recording",
  "call_url",
  "call link",
  "call_link",
  "url",
  "link",
];

const CALL_ID_KEYS = [
  "call_id",
  "call id",
  "callid",
  "external_call_id",
  "external call id",
  "call external id",
];

const DATE_KEYS = ["date", "call_date", "call date", "calldate", "started_at", "started at"];
const TIME_KEYS = ["time", "call_time", "call time", "calltime"];
const AGENT_ID_KEYS = ["agent_id", "agent id", "agentid", "agent code", "agent_code", "employee_code", "employee id", "employee_id", "user_id", "user id", "userid"];
const AGENT_NAME_KEYS = ["agent_name", "agent name", "agentname", "agent"];
const CUSTOMER_NAME_KEYS = ["customer_name", "customer name", "customername", "customer"];
const CUSTOMER_NUMBER_KEYS = [
  "customer_number",
  "customer number",
  "customernumber",
  "phone",
  "phone_number",
  "msisdn",
  "mobile",
  "contact_no",
  "contact no",
  "contactno",
  "contact_number",
  "contact number",
];
const CAMPAIGN_KEYS = ["campaign", "campaign_name", "campaign name"];
const TEAM_KEYS = ["team", "team_name", "team name"];
const DISPOSITION_KEYS = ["disposition", "outcome", "call_disposition"];
const LANGUAGE_KEYS = ["language", "lang", "locale"];
const TALKTIME_KEYS = ["talktime", "talk time", "talk_time", "duration", "call duration", "call_duration"];

function normalizeKey(key: string): string {
  return key.toString().trim().toLowerCase().replace(/\s+/g, " ");
}

function findValue(row: Record<string, unknown>, candidates: string[]): string | null {
  const normalized = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) {
    normalized.set(normalizeKey(k), v);
  }
  for (const candidate of candidates) {
    const key = normalizeKey(candidate);
    if (normalized.has(key)) {
      const v = normalized.get(key);
      if (v == null) continue;
      const s = String(v).trim();
      if (s.length > 0) return s;
    }
  }
  return null;
}

function detectAudioColumn(headerRow: string[]): boolean {
  const normalized = headerRow.map(normalizeKey);
  return AUDIO_URL_KEYS.some((c) => normalized.includes(normalizeKey(c)));
}

function parseDurationToSeconds(durationStr: string | null): number | null {
  if (!durationStr) return null;
  const clean = durationStr.trim();
  if (!clean) return null;

  // If it's a numeric string (e.g. raw seconds)
  const num = Number(clean);
  if (!Number.isNaN(num) && Number.isFinite(num)) {
    return Math.floor(num);
  }

  // Match formats like HH:MM:SS or MM:SS
  const parts = clean.split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p))) return null;

  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }
  return null;
}

function parseDateValue(dateStr: string | null, timeStr: string | null): Date | null {
  if (!dateStr && !timeStr) return null;
  let combined = "";
  if (dateStr && timeStr) combined = `${dateStr} ${timeStr}`;
  else combined = dateStr ?? timeStr ?? "";
  if (!combined) return null;

  // Try Excel serial number (numeric)
  const num = Number(combined);
  if (!Number.isNaN(num) && Number.isFinite(num) && num > 25569 && num < 60000) {
    // Excel epoch is 1899-12-30
    const ms = (num - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.valueOf())) return d;
  }

  const direct = new Date(combined);
  if (!Number.isNaN(direct.valueOf())) return direct;

  // Try DD/MM/YYYY or DD-MM-YYYY
  const m = combined.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:\s+(.*))?$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    let yyyy = Number(m[3]);
    if (yyyy < 100) yyyy += 2000;
    const rest = m[4] ?? "";
    const iso = `${yyyy.toString().padStart(4, "0")}-${mm.toString().padStart(2, "0")}-${dd.toString().padStart(2, "0")}${rest ? "T" + rest : ""}`;
    const d2 = new Date(iso);
    if (!Number.isNaN(d2.valueOf())) return d2;
  }
  return null;
}

/**
 * Parse an Excel/CSV buffer and extract call rows. Validates that at least
 * one supported audio URL column exists. Returns rows that have a URL value
 * and a list of per-row errors for rows that were skipped.
 */
export function parseCallExcel(buffer: Buffer): ParseResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch (e) {
    throw new ExcelParseError(
      e instanceof Error ? `Could not read Excel file: ${e.message}` : "Could not read Excel file.",
    );
  }
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new ExcelParseError("Excel file has no worksheets.");
  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: false,
  });

  if (rawRows.length === 0) {
    throw new ExcelParseError("Excel file is empty.");
  }

  const headerRow = Object.keys(rawRows[0] ?? {});
  if (!detectAudioColumn(headerRow)) {
    throw new ExcelParseError(
      "Excel file must contain an audio_url or recording_url column.",
    );
  }

  const rows: ParsedCallRow[] = [];
  const errors: { row: number; message: string }[] = [];

  rawRows.forEach((raw, idx) => {
    const rowNumber = idx + 2; // +2 for header row + 1-based
    const audioUrl = findValue(raw, AUDIO_URL_KEYS);
    if (!audioUrl) {
      // skip silently per spec — but report as skipped
      errors.push({ row: rowNumber, message: "Empty audio URL — skipped." });
      return;
    }

    const dateStr = findValue(raw, DATE_KEYS);
    const timeStr = findValue(raw, TIME_KEYS);
    const durationStr = findValue(raw, TALKTIME_KEYS);

    rows.push({
      rowNumber,
      audioUrl,
      externalCallId: findValue(raw, CALL_ID_KEYS),
      callDate: parseDateValue(dateStr, timeStr),
      agentCode: findValue(raw, AGENT_ID_KEYS),
      agentName: findValue(raw, AGENT_NAME_KEYS),
      customerName: findValue(raw, CUSTOMER_NAME_KEYS),
      customerNumber: findValue(raw, CUSTOMER_NUMBER_KEYS),
      campaignName: findValue(raw, CAMPAIGN_KEYS),
      teamName: findValue(raw, TEAM_KEYS),
      disposition: findValue(raw, DISPOSITION_KEYS),
      language: findValue(raw, LANGUAGE_KEYS),
      durationSeconds: parseDurationToSeconds(durationStr),
    });
  });

  return { rows, errors, totalRows: rawRows.length };
}
