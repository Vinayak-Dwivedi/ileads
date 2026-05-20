import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ClipboardCheck,
  Sparkles,
  MessageSquare,
  AlertTriangle,
  Lightbulb,
  ShieldCheck,
  Activity,
  ArrowLeft,
} from "lucide-react";
import { EmptyState } from "@/components/ui/page-shell";
import { Pill } from "@/components/ui/pill";
import { AuditStatusPill } from "@/components/ui/score-pill";
import { SentimentBadge } from "@/components/ui/sentiment-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireSession } from "@/lib/auth";
import { withBasePath } from "@/lib/base-path";
import { getCallDetail, getActiveStandardParametersForClient } from "@/lib/data/calls";
import { formatDuration, formatMmSs, formatShortDate, formatTime, formatPercent } from "@/lib/utils";
import { ManualReviewForm } from "./manual-review-form";
import { AudioPlayerCard } from "./audio-player";
import { AuditPanel } from "./audit-panel";
import { TranscriptionActionButton } from "./transcription-action-button";
import { SpeakerCorrectionPanel } from "./speaker-correction-panel";
import { SegmentSpeakerSelect } from "./segment-speaker-select";
import { NotesPanel } from "./notes-panel";
import { isActivelyProcessing } from "@/lib/processing-lock";
import { hasOpenRouterKey } from "@/services/llm";
import { hasSarvamKey, isMockMode, loadSttConfig, shouldShowMockActions } from "@/services/stt";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

const KPI_SLOT_COUNT = 10;

function stringFlags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function speakerMappingNote(flags: string[]): string | null {
  const mode = flags.find((flag) => flag.startsWith("speaker_mapping_mode_"))?.replace("speaker_mapping_mode_", "");
  const confidence = flags
    .find((flag) => flag.startsWith("speaker_mapping_confidence_"))
    ?.replace("speaker_mapping_confidence_", "");
  if (mode === "heuristic") {
    return `Speaker labels from Sarvam diarization, mapped using heuristic confidence: ${confidence ?? "unknown"}.`;
  }
  if (mode === "fixed") {
    return "Speaker labels from Sarvam diarization, fixed mapping: speaker 0 = Agent, speaker 1 = Customer.";
  }
  if (mode === "raw") {
    return "Speaker labels from Sarvam diarization, raw speaker IDs preserved.";
  }
  return null;
}

function speakerSourceLabel(source: string | null, channel: string | null): string | null {
  if (!source) return null;
  if (source === "stereo_channel") return channel ?? "channel";
  if (source === "manual_segment_correction") return "manual segment correction";
  if (source.startsWith("manual_")) return "manual correction";
  if (source.startsWith("sarvam_diarization") && channel) return `speaker ${channel} · ${source}`;
  return source;
}

type Aggregate = {
  passed: number;
  failed: number;
  notFound: number;
  total: number;
  max: number;
  awarded: number;
};

function emptyAggregate(): Aggregate {
  return { passed: 0, failed: 0, notFound: 0, total: 0, max: 0, awarded: 0 };
}

function tone(pct: number | null): "good" | "warning" | "poor" | "muted" {
  if (pct == null) return "muted";
  if (pct >= 80) return "good";
  if (pct >= 50) return "warning";
  return "poor";
}

const KPI_TONE_STYLE: Record<"good" | "warning" | "poor" | "muted", string> = {
  good: "border-l-emerald-500 bg-emerald-50/40",
  warning: "border-l-amber-500 bg-amber-50/40",
  poor: "border-l-red-500 bg-red-50/40",
  muted: "border-l-slate-300 bg-white",
};

export default async function CallDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await requireSession();
  const [call, activeStandard] = await Promise.all([
    getCallDetail(session.clientId, id),
    getActiveStandardParametersForClient(session.clientId),
  ]);
  if (!call) notFound();

  const audit = call.aiAudits[0] ?? null;
  const callIdText = call.externalCallId ?? `CALL-${call.id.slice(-6).toUpperCase()}`;
  const existingReview = call.manualReviews[0] ?? null;
  const audioUrl = call.audioPath ? withBasePath(`/api/calls/${call.id}/audio`) : call.recordingUrl;
  const processingActive = isActivelyProcessing(call.processingStatus, call.processingStartedAt);
  const processingStatusText = processingActive ? call.processingStatus : null;
  const processingFailed = call.processingStatus === "failed";
  const pipelineLabel = processingActive
    ? "Processing"
    : processingFailed
      ? "Failed"
      : audit
        ? "Audited"
        : call.transcript
          ? "Transcribed"
          : "Uploaded";
  const hasAudio = Boolean(audioUrl);
  const sttConfig = loadSttConfig();
  const transcriptFlags = stringFlags(call.transcript?.qualityFlags);
  const mappingNote = speakerMappingNote(transcriptFlags);
  const speakerCorrectionNeedsAudit =
    Boolean(call.transcript?.speakerLabelsCorrected && audit) &&
    Boolean(
      call.transcript?.speakerCorrectedAt &&
      audit?.createdAt &&
      call.transcript.speakerCorrectedAt > audit.createdAt,
    );
  // KPI buckets — one row per active standard parameter for this client.
  // Sub-parameter scores roll up under their standardParameter; if the
  // ClientParameter isn't mapped (e.g. historical), fall back to its
  // category string so it doesn't disappear from the page entirely.
  const kpiBuckets = new Map<string, { label: string; description: string | null; sortOrder: number; agg: Aggregate }>();
  for (const sp of activeStandard) {
    kpiBuckets.set(sp.id, {
      label: sp.name,
      description: sp.description,
      sortOrder: sp.sortOrder,
      agg: emptyAggregate(),
    });
  }
  if (audit) {
    for (const ps of audit.parameterScores) {
      const std = ps.parameter.standardParameter;
      const fallbackKey = `cat:${ps.parameter.parameterCategory}`;
      const key = std ? std.id : fallbackKey;
      let bucket = kpiBuckets.get(key);
      if (!bucket) {
        bucket = {
          label: std?.name ?? ps.parameter.parameterCategory,
          description: std?.description ?? null,
          sortOrder: std?.sortOrder ?? 999,
          agg: emptyAggregate(),
        };
        kpiBuckets.set(key, bucket);
      }
      bucket.agg.total += 1;
      bucket.agg.max += ps.maxScore;
      bucket.agg.awarded += ps.score;
      if (ps.isPassed) bucket.agg.passed += 1;
      else if (ps.result === "FAIL") bucket.agg.failed += 1;
      else bucket.agg.notFound += 1;
    }
  }
  const kpiList = [...kpiBuckets.values()].sort((a, b) => a.sortOrder - b.sortOrder);

  // ===== Tab content =====================================================

  const kpiGrid = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: KPI_SLOT_COUNT }).map((_, i) => {
        const kpi = kpiList[i];
        if (!kpi) {
          return <div key={`empty-${i}`} className="hidden xl:block" aria-hidden />;
        }
        const pct = kpi.agg.max > 0 ? (kpi.agg.awarded / kpi.agg.max) * 100 : null;
        return (
          <KpiCard
            key={kpi.label}
            label={kpi.label}
            description={kpi.description}
            pct={pct}
            awarded={kpi.agg.awarded}
            max={kpi.agg.max}
            passed={kpi.agg.passed}
            failed={kpi.agg.failed}
            notFound={kpi.agg.notFound}
            total={kpi.agg.total}
          />
        );
      })}
    </div>
  );

  const overviewTab = (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
      <div className="space-y-5 min-w-0">
        <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
            <Sparkles className="h-4 w-4" /> Summary
          </div>
          {audit?.summary ? (
            <p className="text-sm text-slate-700">{audit.summary}</p>
          ) : (
            <p className="text-sm text-slate-500">
              Audit summary will appear here once the AI audit has run.
            </p>
          )}
        </article>
      </div>

      <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3">
          <div className="text-sm font-semibold text-slate-900">Call Information</div>
          <p className="text-xs text-slate-500">Audio and metadata for this recording.</p>
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Audio
          </div>
          <AudioPlayerCard recordingUrl={audioUrl} durationSeconds={call.durationSeconds} />
        </div >
        <InfoRow label="Call ID">{callIdText}</InfoRow>
        <InfoRow label="Client">{call.client.name}</InfoRow>
        <InfoRow label="Campaign">{call.campaign?.name ?? "—"}</InfoRow>
        <InfoRow label="Agent ID">{call.agent?.employeeCode ?? "—"}</InfoRow>
        <InfoRow label="Agent Name">{call.agent?.name ?? "—"}</InfoRow>
        <InfoRow label="Date & Time">
          {formatShortDate(call.callStartedAt)} · {formatTime(call.callStartedAt)}
        </InfoRow>
        {call.customerName ? <InfoRow label="Customer name">{call.customerName}</InfoRow> : null}
        {
          call.durationSeconds != null ? (
            <InfoRow label="Duration">{formatDuration(call.durationSeconds)}</InfoRow>
          ) : null
        }
        <InfoRow label="Disposition">{call.disposition ?? "—"}</InfoRow>

        <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-3">
          <span className="text-xs text-slate-500">Audit</span>
          <AuditStatusPill status={audit?.status ?? (call.aiScore != null ? "COMPLETED" : "PENDING")} />
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-3">
          <span className="text-xs text-slate-500">Customer Sentiment</span>
          <SentimentBadge value={call.sentiment} />
        </div>
      </article >
    </div >
  );

  const transcriptTab = (
    <article className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <MessageSquare className="h-4 w-4" /> Transcript
          </div>
          <TranscriptionActionButton
            callId={call.id}
            hasAudio={hasAudio}
            hasTranscript={!!call.transcript}
            mockMode={isMockMode()}
            sttProvider={sttConfig.provider}
            sarvamKeyConfigured={hasSarvamKey(sttConfig)}
            processingStatus={processingStatusText}
            processingFailed={processingFailed}
            compact
          />
        </div>
        <div className="mt-2 text-right text-xs font-normal text-slate-500">
          {call.transcript
            ? `${call.transcript.segments.length} segments · ${call.transcript.modelUsed ?? "unknown model"}`
            : "no transcript"}
        </div>
      </div>
      {!call.transcript ? (
        <EmptyState
          title="No transcript"
          description="No transcript available. Run transcription first when STT is enabled."
        />
      ) : (
        <div className="space-y-3">
          {call.transcript.fallbackUsed ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Transcribed using fallback model: {call.transcript.modelUsed ?? "unknown"}.
              {call.transcript.fallbackReason ? ` Reason: ${call.transcript.fallbackReason}.` : ""}
            </div>
          ) : null}
          {transcriptFlags.includes("heuristic_speaker_labels") ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Speaker labels are heuristic because this recording was processed as mono.
            </div>
          ) : null}
          {mappingNote ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              {mappingNote}
            </div>
          ) : null}
          {call.transcript.speakerLabelsCorrected ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              Speaker labels were manually corrected
              {call.transcript.speakerCorrectedAt
                ? ` on ${formatShortDate(call.transcript.speakerCorrectedAt)}.`
                : "."}
            </div>
          ) : null}
          <SpeakerCorrectionPanel
            callId={call.id}
            hasTranscript={!!call.transcript}
            hasAudit={!!audit}
            needsAuditRerun={speakerCorrectionNeedsAudit}
            processingStatus={processingStatusText}
          />
          <div className="max-h-[760px] space-y-3 overflow-y-auto pr-2">
            {call.transcript.segments.map((s) => (
              <div key={s.id} className="flex gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3 text-[13px]">
                <div
                  className={`grid h-8 w-8 flex-none place-items-center rounded-full text-sm font-bold ${s.speaker === "AGENT"
                    ? "bg-blue-100 text-blue-700"
                    : s.speaker === "CUSTOMER"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-200 text-slate-700"
                    }`}
                >
                  {s.speaker.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="inline-flex items-center gap-2 font-semibold text-slate-700">
                      <SegmentSpeakerSelect
                        segmentId={s.id}
                        speaker={s.speaker === "SYSTEM" ? "UNKNOWN" : (s.speaker as "AGENT" | "CUSTOMER" | "UNKNOWN")}
                        disabled={!!processingStatusText}
                      />
                      {speakerSourceLabel(s.speakerSource, s.channel) ? (
                        <span className="ml-2 font-normal text-slate-400">
                          {speakerSourceLabel(s.speakerSource, s.channel)}
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-slate-500">
                      {formatMmSs(Math.floor(s.startMs / 1000))}
                      {s.confidenceScore != null ? ` · ${Math.round(s.confidenceScore * 100)}%` : ""}
                    </span>
                  </div>
                  <p className="mt-1 leading-relaxed text-slate-700">{s.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );

  const auditResultsTab = (
    <div className="space-y-5">
      <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <ClipboardCheck className="h-4 w-4" /> Parameter Scores
            <span className="ml-2 text-xs font-normal text-slate-500">Binary scoring</span>
          </div>
          <div className="flex-1 min-w-[300px] flex justify-end">
            <AuditPanel
              callId={call.id}
              hasAudit={!!audit}
              hasTranscript={!!call.transcript}
              hasParameters={activeStandard.length > 0 || !!audit}
              latestRunNo={audit?.auditRunNo ?? null}
              isDevelopment={process.env.NODE_ENV !== "production"}
              showMockAuditButton={shouldShowMockActions()}
              openrouterKeyConfigured={hasOpenRouterKey()}
              processingStatus={processingStatusText}
            />
          </div>
        </div>
        {!audit || audit.parameterScores.length === 0 ? (
          <EmptyState
            title="No parameter scores"
            description="Parameter-level scores appear once the AI audit runs."
          />
        ) : (
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow>
                <TableHead>Standard KPI</TableHead>
                <TableHead>Parameter</TableHead>
                <TableHead>Max</TableHead>
                <TableHead>Awarded</TableHead>
                <TableHead>Result</TableHead>
                <TableHead className="w-[36%]">Reason / Evidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.parameterScores.map((ps) => (
                <TableRow key={ps.id} className="align-top">
                  <TableCell className="text-slate-500 align-top whitespace-normal">
                    {ps.parameter.standardParameter?.name ?? ps.parameter.parameterCategory}
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">
                    <div className="font-medium text-slate-700">{ps.parameter.parameterName}</div>
                    <div className="text-xs text-slate-500">{ps.parameter.parameterDescription}</div>
                  </TableCell>
                  <TableCell className="align-top">{ps.maxScore}</TableCell>
                  <TableCell className="align-top font-medium">{ps.score}</TableCell>
                  <TableCell className="align-top">
                    <Pill tone={ps.isPassed ? "green" : ps.result === "FAIL" ? "red" : "yellow"}>
                      {ps.isPassed ? "Pass" : ps.result === "FAIL" ? "Fail" : "Not found"}
                    </Pill>
                  </TableCell>
                  <TableCell className="max-w-[420px] align-top whitespace-normal text-slate-600">
                    {ps.reasoning ?? "—"}
                    {ps.evidenceText ? (
                      <div className="mt-1 text-xs italic text-slate-500">“{ps.evidenceText}”</div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </article>

      <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
          <Lightbulb className="h-4 w-4" /> AI Insights
        </div>
        {call.insights.length === 0 ? (
          <EmptyState title="No insights" description="No AI insights yet for this call." />
        ) : (
          <div className="space-y-2.5">
            {call.insights.map((i) => {
              const ptone =
                i.severity === "CRITICAL" || i.severity === "HIGH"
                  ? "red"
                  : i.severity === "MEDIUM"
                    ? "yellow"
                    : "blue";
              const Icon =
                i.insightType === "COMPLIANCE"
                  ? ShieldCheck
                  : i.insightType === "RISK"
                    ? AlertTriangle
                    : i.insightType === "COACHING"
                      ? Lightbulb
                      : Sparkles;
              return (
                <div key={i.id} className="flex gap-3 rounded-lg bg-slate-50 p-3">
                  <div className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white">
                    <Icon className="h-4 w-4 text-slate-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-slate-700">{i.title}</div>
                      <Pill tone={ptone}>{i.severity}</Pill>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{i.body}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </article>
    </div>
  );

  const notesTab = (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-5">
        <ManualReviewForm
          callId={call.id}
          initial={
            existingReview
              ? {
                reviewerName: existingReview.reviewerName,
                status: existingReview.status,
                score: existingReview.scorePercent,
                notes: existingReview.notes,
                disposition: call.manualDisposition,
              }
              : {
                reviewerName: "",
                status: "PENDING",
                score: null,
                notes: null,
                disposition: call.manualDisposition,
              }
          }
        />
        <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
            <Activity className="h-4 w-4" /> Timeline
          </div>
          {call.events.length === 0 ? (
            <EmptyState title="No events" description="No call events recorded yet." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Speaker</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {call.events.map((e) => (
                  <TableRow key={e.id} className="align-top">
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {formatShortDate(e.occurredAt)} · {formatTime(e.occurredAt)}
                    </TableCell>
                    <TableCell className="whitespace-normal text-sm font-medium text-slate-700">
                      {e.title ?? e.eventType}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{e.speaker ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {e.severity ? <Pill tone={e.severity === "HIGH" || e.severity === "CRITICAL" ? "red" : e.severity === "MEDIUM" ? "yellow" : "blue"}>{e.severity}</Pill> : "—"}
                    </TableCell>
                    <TableCell className="whitespace-normal text-xs text-slate-600">
                      {e.description ?? "—"}
                      {e.evidenceText ? <div className="mt-1 italic text-slate-500">“{e.evidenceText}”</div> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </article>
      </div>
      <NotesPanel
        callId={call.id}
        notes={call.notes.map((n) => ({
          id: n.id,
          author: n.authorName,
          body: n.body,
          isPinned: n.isPinned,
          createdAt: n.createdAt.toISOString(),
        }))}
      />
    </div>
  );

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-4 md:gap-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href="/calls" className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-900">
                <ArrowLeft className="h-4 w-4" /> Calls
              </Link>
              <h2 className="truncate text-xl font-semibold tracking-tight text-slate-900">{callIdText}</h2>
              <p className="text-sm text-slate-500">
                {call.client.name}
                {call.agent?.name ? ` · ${call.agent.name}` : ""}
                {call.callStartedAt ? ` · ${formatShortDate(call.callStartedAt)} ${formatTime(call.callStartedAt)}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={processingFailed ? "red" : processingActive ? "blue" : audit ? "green" : call.transcript ? "yellow" : "slate"}>
                {pipelineLabel}
              </Pill>
              <AuditStatusPill status={audit?.status ?? (call.aiScore != null ? "COMPLETED" : "PENDING")} />
              <SentimentBadge value={call.sentiment} />
            </div>
          </div>
          {kpiGrid}

          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="w-full justify-start overflow-x-auto rounded-lg border border-slate-200 bg-white px-2" variant="line">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="transcript">Transcript</TabsTrigger>
              <TabsTrigger value="audit">Audit Results</TabsTrigger>
              <TabsTrigger value="notes">Notes &amp; Timeline</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="mt-4">
              {overviewTab}
            </TabsContent>
            <TabsContent value="transcript" className="mt-4">
              {transcriptTab}
            </TabsContent>
            <TabsContent value="audit" className="mt-4">
              {auditResultsTab}
            </TabsContent>
            <TabsContent value="notes" className="mt-4">
              {notesTab}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] border-b border-border py-2.5 text-[13px] last:border-0">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{children}</span>
    </div>
  );
}

function KpiCard({
  label,
  description,
  pct,
  awarded,
  max,
  passed,
  failed,
  notFound,
  total,
}: {
  label: string;
  description: string | null;
  pct: number | null;
  awarded: number;
  max: number;
  passed: number;
  failed: number;
  notFound: number;
  total: number;
}) {
  const t = tone(pct);
  return (
    <div
      className={`rounded-lg border border-l-4 border-slate-100 p-4 shadow-sm ${KPI_TONE_STYLE[t]}`}
      title={description ?? undefined}
    >
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-lg font-bold text-slate-800">
          {pct == null ? "—" : formatPercent(pct, 0)}
        </span>
        {max > 0 ? (
          <span className="text-[11px] text-slate-500">
            {awarded}/{max}
          </span>
        ) : null}
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        {total === 0 ? (
          <span>Pending audit</span>
        ) : (
          <span>
            {passed} pass · {failed} fail{notFound ? ` · ${notFound} n/f` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
