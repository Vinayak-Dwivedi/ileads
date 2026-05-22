"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  UploadCloud,
  X,
  FileAudio,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  // DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { withBasePath } from "@/lib/base-path";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const AUDIO_ACCEPT =
  ".mp3,.wav,.m4a,.ogg,.webm,.aac,.flac,audio/mpeg,audio/wav,audio/mp4,audio/ogg,audio/webm,audio/aac,audio/flac";
const EXCEL_ACCEPT =
  ".xlsx,.xls,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";

export interface CallUploadOptions {
  client: { id: string; name: string } | null;
  campaigns: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  agents: { id: string; name: string; teamId: string | null }[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface ExcelImportError {
  row: number;
  message: string;
}

interface ExcelImportResult {
  imported: number;
  skipped: number;
  failed: number;
  totalRows: number;
  errors: ExcelImportError[];
}

export function UploadCallsDialog({
  options,
  maxFileMb = 100,
}: {
  options: CallUploadOptions;
  maxFileMb?: number;
}) {
  const maxBytes = Math.max(1, maxFileMb) * 1024 * 1024;
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"audio" | "excel">("audio");

  // ---------- Audio mode state ----------
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // ---------- Excel mode state ----------
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelError, setExcelError] = useState<string | null>(null);
  const [excelResult, setExcelResult] = useState<ExcelImportResult | null>(null);
  const [excelPending, startExcelTransition] = useTransition();

  const totalSize = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const client = options.client;

  function addFiles(nextFiles: FileList | null) {
    if (!nextFiles) return;
    setError(null);
    setSuccess(null);
    const rejected: string[] = [];
    setFiles((current) => {
      const byKey = new Map(
        current.map((file) => [`${file.name}-${file.size}-${file.lastModified}`, file]),
      );
      for (const file of Array.from(nextFiles)) {
        if (file.size > maxBytes) {
          rejected.push(file.name);
          continue;
        }
        byKey.set(`${file.name}-${file.size}-${file.lastModified}`, file);
      }
      return Array.from(byKey.values());
    });
    if (rejected.length > 0) {
      setError(
        `File${rejected.length === 1 ? " is" : "s are"} too large. Maximum allowed size is ${maxFileMb} MB. Skipped: ${rejected.join(", ")}`,
      );
    }
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, i) => i !== index));
  }

  function resetAudio(opts: { keepSuccess?: boolean } = {}) {
    setFiles([]);
    setError(null);
    if (!opts.keepSuccess) setSuccess(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function resetExcel(opts: { keepResult?: boolean } = {}) {
    setExcelFile(null);
    setExcelError(null);
    if (!opts.keepResult) setExcelResult(null);
    if (excelInputRef.current) excelInputRef.current.value = "";
  }

  function submitAudio(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) {
      setError("No active client is available for uploads.");
      return;
    }
    if (files.length === 0) {
      setError("Select at least one audio file.");
      return;
    }

    const form = new FormData(event.currentTarget);
    form.delete("files");
    files.forEach((file) => form.append("files", file));
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      try {
        const response = await fetch(withBasePath("/api/calls/upload"), {
          method: "POST",
          body: form,
          credentials: "same-origin",
        });
        const contentType = response.headers.get("content-type") ?? "";
        const rawText = await response.text();
        let body: { error?: string; count?: number; ok?: boolean } = {};
        if (contentType.includes("application/json")) {
          try {
            body = JSON.parse(rawText) as typeof body;
          } catch {
            /* non-JSON path handled below */
          }
        }

        if (!response.ok) {
          if (response.status === 413) {
            throw new Error(
              `Upload failed: file is too large. Maximum allowed size is ${maxFileMb} MB.`,
            );
          }
          if (response.status === 401 || response.status === 403) {
            throw new Error(
              `Upload failed: your session may have expired (HTTP ${response.status}). Sign out and sign back in.`,
            );
          }
          if (response.status >= 500) {
            throw new Error(
              `Upload failed: server error (HTTP ${response.status}). ${rawText.slice(0, 200) || ""}`,
            );
          }
          throw new Error(body.error ?? `Upload failed (HTTP ${response.status}).`);
        }

        if (!body.ok) {
          throw new Error(body.error ?? "Upload failed: server returned no confirmation.");
        }

        const count = body.count ?? files.length;
        setSuccess(`${count} call${count === 1 ? "" : "s"} uploaded.`);
        resetAudio({ keepSuccess: true });
        router.refresh();
      } catch (e) {
        if (e instanceof TypeError && /failed to fetch|network/i.test(e.message)) {
          setError("Could not reach the server. Check your network connection and try again.");
        } else {
          setError(e instanceof Error ? e.message : "Upload failed.");
        }
      }
    });
  }

  function submitExcel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) {
      setExcelError("No active client is available for imports.");
      return;
    }
    if (!excelFile) {
      setExcelError("Select an Excel file (xlsx/xls/csv).");
      return;
    }
    setExcelError(null);
    setExcelResult(null);

    const form = new FormData();
    form.append("clientId", client.id);
    form.append("file", excelFile);

    startExcelTransition(async () => {
      try {
        const response = await fetch(withBasePath("/api/calls/import-excel"), {
          method: "POST",
          body: form,
          credentials: "same-origin",
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          ok?: boolean;
          imported?: number;
          skipped?: number;
          failed?: number;
          totalRows?: number;
          errors?: ExcelImportError[];
        };
        if (!response.ok || !body.ok) {
          throw new Error(body.error ?? `Import failed (HTTP ${response.status}).`);
        }
        setExcelResult({
          imported: body.imported ?? 0,
          skipped: body.skipped ?? 0,
          failed: body.failed ?? 0,
          totalRows: body.totalRows ?? 0,
          errors: body.errors ?? [],
        });
        if (excelInputRef.current) excelInputRef.current.value = "";
        setExcelFile(null);
        router.refresh();
      } catch (e) {
        setExcelError(e instanceof Error ? e.message : "Excel import failed.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={"outline"}>
          <UploadCloud className="h-4 w-4" />
          Upload Calls
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden border-slate-200 bg-white p-0 shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
        <DialogHeader className="border-b border-slate-100 px-6 py-5">
          <DialogTitle className="text-xl text-slate-900">Upload Calls</DialogTitle>
          {/* <DialogDescription>
            Add one or more audio recordings, or upload an Excel sheet of audio URLs.
            After upload, open a call to run transcription and the AI audit. Longer calls
            may take several minutes to process.
          </DialogDescription> */}
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "audio" | "excel")} className="w-full">
          <div className="border-b border-slate-100 bg-slate-50/60 px-6 pt-3">
            <TabsList variant="line">
              <TabsTrigger value="audio">Audio files</TabsTrigger>
              <TabsTrigger value="excel">Excel sheet</TabsTrigger>
            </TabsList>
          </div>

          {/* -------------------- AUDIO TAB -------------------- */}
          <TabsContent value="audio" className="m-0">
            <form onSubmit={submitAudio} className="grid max-h-[78vh] grid-rows-[1fr_auto]">
              <div className="overflow-y-auto px-6 py-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Client" required>
                    <select
                      name="clientId"
                      required
                      defaultValue={client?.id ?? ""}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
                    >
                      {client ? (
                        <option value={client.id}>{client.name}</option>
                      ) : (
                        <option value="">No client</option>
                      )}
                    </select>
                  </Field>
                  <Field label="Call date/time">
                    <input
                      type="datetime-local"
                      name="callStartedAt"
                      className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-700"
                    />
                  </Field>
                  <Field label="Campaign">
                    <select name="campaignId" className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
                      <option value="">No campaign</option>
                      {options.campaigns.map((campaign) => (
                        <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Agent">
                    <select name="agentId" className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
                      <option value="">No agent</option>
                      {options.agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>{agent.name}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="mt-5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      addFiles(event.dataTransfer.files);
                    }}
                    className={cn(
                      "flex min-h-36 w-full flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-4 text-center transition-colors hover:border-blue-300 hover:bg-blue-50/40",
                      files.length > 0 && "border-blue-200 bg-blue-50/30",
                    )}
                  >
                    <UploadCloud className="mb-3 h-8 w-8 text-blue-600" />
                    <span className="text-sm font-semibold text-slate-800">Select or drop audio files</span>
                    <span className="mt-1 text-xs text-slate-500">MP3, WAV, M4A, OGG, WEBM, AAC, FLAC</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    name="files"
                    accept={AUDIO_ACCEPT}
                    multiple
                    className="hidden"
                    onChange={(event) => addFiles(event.target.files)}
                  />
                </div>

                <div className="mt-4 rounded-lg border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <div className="text-sm font-semibold text-slate-800">Selected files</div>
                    <div className="text-xs text-slate-500">
                      {files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(totalSize)}
                    </div>
                  </div>
                  {files.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-slate-500">No files selected.</div>
                  ) : (
                    <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto">
                      {files.map((file, index) => (
                        <li key={`${file.name}-${file.size}-${file.lastModified}`} className="flex items-center gap-3 px-4 py-3">
                          <FileAudio className="h-4 w-4 text-blue-600" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-slate-700">{file.name}</div>
                            <div className="text-xs text-slate-500">{formatBytes(file.size)}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFile(index)}
                            className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50"
                            title="Remove file"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {pending ? (
                  <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                    <div className="flex items-center gap-2">
                      <UploadCloud className="h-4 w-4 animate-pulse" />
                      Uploading {files.length} file{files.length === 1 ? "" : "s"} ({formatBytes(totalSize)}). Please keep this window open.
                    </div>
                  </div>
                ) : null}
                {error ? (
                  <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
                  </div>
                ) : null}
                {success ? (
                  <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> {success}
                  </div>
                ) : null}
                {!client ? (
                  <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    <AlertTriangle className="h-4 w-4" /> No active client is available for uploads.
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-6 py-4">
                <button type="button" onClick={() => resetAudio()} disabled={pending || files.length === 0} className="h-10 rounded-md border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  Clear
                </button>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setOpen(false)} disabled={pending} className="h-10 rounded-md border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={pending || files.length === 0}
                    className="h-10 rounded-md bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {pending ? "Uploading..." : "Upload selected"}
                  </button>
                </div>
              </div>
            </form>
          </TabsContent>

          {/* -------------------- EXCEL TAB -------------------- */}
          <TabsContent value="excel" className="m-0">
            <form onSubmit={submitExcel} className="grid max-h-[78vh] grid-rows-[1fr_auto]">
              <div className="overflow-y-auto px-6 py-5">
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm text-slate-700">
                  <div className="mb-2 font-semibold text-slate-800">Expected columns</div>
                  <p className="text-xs text-slate-600">
                    <strong>Required:</strong> one of <code className="rounded bg-white px-1 py-0.5 text-[11px]">audio_url</code>,
                    {" "}<code className="rounded bg-white px-1 py-0.5 text-[11px]">recording_url</code>,
                    {" "}<code className="rounded bg-white px-1 py-0.5 text-[11px]">audio link</code>, or
                    {" "}<code className="rounded bg-white px-1 py-0.5 text-[11px]">call_url</code>.
                  </p>
                  <p className="mt-2 text-xs text-slate-600">
                    <strong>Optional:</strong> call_id, date, time, agent_id, agent_name,
                    customer_name, customer_number, campaign, team, disposition, language.
                    Column matching is case-insensitive.
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Each row's audio URL is downloaded server-side into
                    {" "}<code className="rounded bg-white px-1 py-0.5 text-[11px]">storage/audio/YYYY-MM-DD/</code>.
                    Only http(s) URLs are allowed. Rows with empty URLs are skipped.
                  </p>
                </div>

                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => excelInputRef.current?.click()}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const f = event.dataTransfer.files?.[0];
                      if (f) setExcelFile(f);
                    }}
                    className={cn(
                      "flex min-h-32 w-full flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-4 text-center transition-colors hover:border-emerald-300 hover:bg-emerald-50/40",
                      excelFile && "border-emerald-200 bg-emerald-50/30",
                    )}
                  >
                    <FileSpreadsheet className="mb-3 h-8 w-8 text-emerald-600" />
                    <span className="text-sm font-semibold text-slate-800">
                      {excelFile ? excelFile.name : "Select or drop an Excel/CSV file"}
                    </span>
                    <span className="mt-1 text-xs text-slate-500">
                      {excelFile ? formatBytes(excelFile.size) : "XLSX, XLS, XLSM, CSV"}
                    </span>
                  </button>
                  <input
                    ref={excelInputRef}
                    type="file"
                    accept={EXCEL_ACCEPT}
                    className="hidden"
                    onChange={(event) => {
                      const f = event.target.files?.[0] ?? null;
                      setExcelFile(f);
                      setExcelError(null);
                      setExcelResult(null);
                    }}
                  />
                </div>

                {excelPending ? (
                  <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                    Reading sheet and downloading audio files. This can take several minutes
                    depending on file count and audio size. Keep this window open.
                  </div>
                ) : null}

                {excelError ? (
                  <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {excelError}
                  </div>
                ) : null}

                {excelResult ? (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                      <div className="flex items-center gap-2 font-semibold">
                        <CheckCircle2 className="h-4 w-4" /> Import finished
                      </div>
                      <div className="mt-1 text-xs">
                        Imported <strong>{excelResult.imported}</strong> · Skipped{" "}
                        <strong>{excelResult.skipped}</strong> · Failed{" "}
                        <strong>{excelResult.failed}</strong> ·
                        Total rows: {excelResult.totalRows}
                      </div>
                    </div>
                    {excelResult.errors.length > 0 ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <div className="mb-1 font-semibold">Per-row issues</div>
                        <ul className="max-h-48 list-disc overflow-y-auto pl-4">
                          {excelResult.errors.map((e, i) => (
                            <li key={`${e.row}-${i}`}>
                              <strong>Row {e.row}:</strong> {e.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {!client ? (
                  <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    <AlertTriangle className="h-4 w-4" /> No active client is available for imports.
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/80 px-6 py-4">
                <button type="button" onClick={() => resetExcel()} disabled={excelPending || (!excelFile && !excelResult)} className="h-10 rounded-md border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  Clear
                </button>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setOpen(false)} disabled={excelPending} className="h-10 rounded-md border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={excelPending || !excelFile || !client}
                    className="h-10 rounded-md bg-emerald-600 px-5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {excelPending ? "Importing..." : "Import sheet"}
                  </button>
                </div>
              </div>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-500">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      {children}
    </label>
  );
}
