import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ClipboardCheck,
  Sparkles,
  MessageSquare,
  AlertTriangle,
  Lightbulb,
  ShieldCheck,
} from "lucide-react";
import { Topbar } from "@/components/layout/topbar";
import { PageShell, EmptyState } from "@/components/ui/page-shell";
import { Pill } from "@/components/ui/pill";
import { AuditStatusPill } from "@/components/ui/score-pill";
import { SentimentBadge } from "@/components/ui/sentiment-badge";
import { requireSession } from "@/lib/auth";
import { withBasePath } from "@/lib/base-path";
import { prisma } from "@/lib/db";
import { getCallDetail } from "@/lib/data/calls";
import { formatDuration, formatMmSs, formatShortDate, formatTime, formatPercent } from "@/lib/utils";
import { ManualReviewForm } from "./manual-review-form";
import { AudioPlayerCard } from "./audio-player";
import { AuditPanel } from "./audit-panel";
import { TranscriptionActionButton } from "./transcription-action-button";
import { SpeakerCorrectionPanel } from "./speaker-correction-panel";
import { SegmentSpeakerSelect } from "./segment-speaker-select";
import { isActivelyProcessing } from "@/lib/processing-lock";
import { DetailTabs } from "./detail-tabs";
import { hasOpenRouterKey } from "@/services/llm";
import { hasSarvamKey, isMockMode, loadSttConfig, shouldShowMockActions } from "@/services/stt";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

const HIGHLIGHT_CATEGORIES = [
  { label: "Opening", accent: "border-l-emerald-500" },
  { label: "Closure", accent: "border-l-violet-500" },
  { label: "Compliance", accent: "border-l-red-500" },
  { label: "Solution", accent: "border-l-blue-500" },
  { label: "Soft skills", accent: "border-l-amber-500" },
  { label: "Discovery", accent: "border-l-orange-500" },
] as const;

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

export default async function CallDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await requireSession();
  const [call, activeParameterCount] = await Promise.all([
    getCallDetail(session.clientId, id),
    prisma.clientParameter.count({ where: { clientId: session.clientId, isActive: true } }),
  ]);
  if (!call) notFound();

  const audit = call.aiAudits[0] ?? null;
  const callIdText = call.externalCallId ?? `CALL-${call.id.slice(-6).toUpperCase()}`;
  const existingReview = call.manualReviews[0] ?? null;
  const audioUrl = call.audioPath ? withBasePath(`/api/calls/${call.id}/audio`) : call.recordingUrl;
  const processingActive = isActivelyProcessing(call.processingStatus, call.processingStartedAt);
  const processingStatusText = processingActive ? call.processingStatus : null;
  const processingFailed = call.processingStatus === "failed";
  const processingStale = Boolean(call.processingStatus && !processingActive && call.processingStatus !== "idle" && call.processingStatus !== "failed");
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

  // group parameter scores by category for highlight cards
  const scoresByCategory = new Map<
    string,
    { passed: number; total: number; max: number; awarded: number }
  >();
  if (audit) {
    for (const ps of audit.parameterScores) {
      const key = ps.parameter.parameterCategory;
      const agg = scoresByCategory.get(key) ?? { passed: 0, total: 0, max: 0, awarded: 0 };
      agg.total += 1;
      agg.max += ps.maxScore;
      agg.awarded += ps.score;
      if (ps.isPassed) agg.passed += 1;
      scoresByCategory.set(key, agg);
    }
  }

  const aiInsightsTab = (
    <article className="html-card p-5">
      <div className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-3">
        <Sparkles className="h-4 w-4" /> AI Insights
      </div>
      {audit?.summary ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600 mb-4">
          <div className="text-xs font-bold text-slate-800 mb-1.5">AI Summary</div>
          {audit.summary}
        </div>
      ) : null}
      {call.insights.length === 0 ? (
        <EmptyState title="No insights" description="No AI insights yet for this call." />
      ) : (
        <div className="space-y-2.5">
          {call.insights.map((i: { id: string; severity: string; insightType: string; title: string; body: string }) => {
            const tone =
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
              <div key={i.id} className="flex gap-3 p-3 bg-slate-50 rounded-lg">
                <div className="w-8 h-8 rounded-full grid place-items-center bg-white border border-slate-200">
                  <Icon className="h-4 w-4 text-slate-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-700">{i.title}</div>
                      <Pill tone={tone}>{i.severity}</Pill>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{i.body}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );

  const scoringTab = (
    <article className="html-card p-5">
      <div className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-3">
        <ClipboardCheck className="h-4 w-4" /> Parameter Scores
        <span className="ml-auto text-xs font-normal text-slate-500">Binary scoring</span>
      </div>
      {!audit || audit.parameterScores.length === 0 ? (
        <EmptyState
          title="No parameter scores"
          description="Parameter-level scores appear once the AI audit runs."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-100">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
              <tr>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Parameter</th>
                <th className="px-3 py-2 text-left">Max</th>
                <th className="px-3 py-2 text-left">Awarded</th>
                <th className="px-3 py-2 text-left">Result</th>
                <th className="px-3 py-2 text-left">Reason / Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {audit.parameterScores.map((ps: {
                id: string;
                maxScore: number;
                score: number;
                isPassed: boolean;
                reasoning: string | null;
                evidenceText: string | null;
                parameter: {
                  parameterCategory: string;
                  parameterName: string;
                  parameterDescription: string | null;
                };
              }) => (
                <tr key={ps.id}>
                  <td className="px-3 py-2 text-slate-500 align-top">{ps.parameter.parameterCategory}</td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-slate-700">{ps.parameter.parameterName}</div>
                    <div className="text-xs text-slate-500">{ps.parameter.parameterDescription}</div>
                    </td>
                  <td className="px-3 py-2 align-top">{ps.maxScore}</td>
                  <td className="px-3 py-2 align-top font-medium">{ps.score}</td>
                  <td className="px-3 py-2 align-top">
                    <Pill tone={ps.isPassed ? "green" : "red"}>{ps.isPassed ? "Pass" : "Fail"}</Pill>
                  </td>
                  <td className="px-3 py-2 align-top text-slate-600">
                    {ps.reasoning ?? "—"}
                    {ps.evidenceText ? (
                      <div className="text-xs italic text-slate-500 mt-1">“{ps.evidenceText}”</div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );

  const manualReviewTab = (
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
          : { reviewerName: "", status: "PENDING", score: null, notes: null, disposition: call.manualDisposition }
      }
    />
  );

  const transcriptTab = (
    <article className="html-card p-5 min-w-0">
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
        <div className="space-y-3 max-h-[760px] overflow-y-auto pr-2">
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
          {call.transcript.segments.map((s: {
            id: string;
            speaker: string;
            speakerSource: string | null;
            channel: string | null;
            startMs: number;
            confidenceScore: number | null;
            text: string;
          }) => (
              <div key={s.id} className="flex gap-3 p-3 bg-slate-50 rounded-lg text-[13px]">
              <div
                className={`w-8 h-8 rounded-full grid place-items-center font-bold flex-none text-sm ${
                  s.speaker === "AGENT"
                    ? "bg-blue-100 text-blue-700"
                    : s.speaker === "CUSTOMER"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-200 text-slate-700"
                }`}
              >
                {s.speaker.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
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
                  <span className="text-slate-500">
                    {formatMmSs(Math.floor(s.startMs / 1000))}
                    {s.confidenceScore != null ? ` · ${Math.round(s.confidenceScore * 100)}%` : ""}
                  </span>
                </div>
                <p className="text-slate-700 mt-1 leading-relaxed">{s.text}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );

  const auditPipelineTab = (
    <AuditPanel
      callId={call.id}
      hasAudit={!!audit}
      hasTranscript={!!call.transcript}
      hasParameters={activeParameterCount > 0}
      latestRunNo={audit?.auditRunNo ?? null}
      isDevelopment={process.env.NODE_ENV !== "production"}
      showMockAuditButton={shouldShowMockActions()}
      openrouterKeyConfigured={hasOpenRouterKey()}
      processingStatus={processingStatusText}
    />
  );

  return (
    <>
      <Topbar
        title="Call Detail"
        
        right={
          <Link
            href="/calls"
            className="h-9 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" /> Back to calls
          </Link>
        }
      />
      <PageShell className="html-page-bg px-6 py-[18px]">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {HIGHLIGHT_CATEGORIES.map(({ label, accent }) => {
            const agg = scoresByCategory.get(label);
            const pct = agg && agg.max > 0 ? (agg.awarded / agg.max) * 100 : null;
            return (
              <KpiCard
                key={label}
                label={label}
                accent={accent}
                pct={pct}
                passed={agg?.passed ?? 0}
                total={agg?.total ?? 0}
              />
            );
          })}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 lg:items-stretch lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
          <div className="space-y-5 min-w-0 h-full">
            <DetailTabs
              tabs={[
                { id: "insights", label: "AI Insights", content: aiInsightsTab },
                { id: "scoring", label: "Scoring", content: scoringTab },
                { id: "manual", label: "Manual review", content: manualReviewTab },
                { id: "transcript", label: "Transcript", content: transcriptTab },
                { id: "audit", label: "AI Audit Pipeline", content: auditPipelineTab },
              ]}
            />
          </div>

          <div className="space-y-5 h-full flex flex-col">
            <AudioPlayerCard
              recordingUrl={audioUrl}
              durationSeconds={call.durationSeconds}
              events={call.events.map((e: { id: string; eventType: string; occurredAt: Date }) => ({
                id: e.id,
                type: e.eventType,
                occurredAt: e.occurredAt.toISOString(),
              }))}
              callStartedAt={call.callStartedAt?.toISOString() ?? null}
              variant="compact"
            />

            <article className="html-card p-5">
              <div className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                Call Information
              </div>
              <InfoRow label="Call ID">{callIdText}</InfoRow>
              <InfoRow label="Process">{call.client.name}</InfoRow>
              <InfoRow label="Campaign">{call.campaign?.name ?? "—"}</InfoRow>
              <InfoRow label="Agent ID">{call.agent?.employeeCode ?? "—"}</InfoRow>
              <InfoRow label="Agent Name">{call.agent?.name ?? "—"}</InfoRow>
              <InfoRow label="Date & Time">
                {formatShortDate(call.callStartedAt)} · {formatTime(call.callStartedAt)}
              </InfoRow>
              <InfoRow label="Customer name">{call.customerName ?? "—"}</InfoRow>
              <InfoRow label="Duration">{formatDuration(call.durationSeconds)}</InfoRow>
              <InfoRow label="Disposition">{call.disposition ?? "—"}</InfoRow>
              <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100">
                <span className="text-xs text-slate-500">Audit</span>
                <AuditStatusPill status={audit?.status ?? (call.aiScore != null ? "COMPLETED" : "PENDING")} />
              </div>
              <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100">
                <span className="text-xs text-slate-500">Customer Sentiment</span>
                <SentimentBadge value={call.sentiment} />
              </div>
            </article>
            <div className="flex-1" />
          </div>
        </div>
      </PageShell>
    </>
  );
}

function ScoreText({ v }: { v: number | null }) {
  if (v == null) return <>—</>;
  return <>{Math.round(v)}%</>;
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
  accent,
  pct,
  passed,
  total,
}: {
  label: string;
  accent: string;
  pct: number | null;
  passed: number;
  total: number;
}) {
  return (
    <div className={`bg-white rounded-lg p-4 border border-slate-100 border-l-4 ${accent}`}>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-800">
        {pct == null ? "—" : formatPercent(pct, 0)}
      </div>
      <div className="text-[11px] text-slate-500">
        {passed}/{total} parameters passed
      </div>
    </div>
  );
}
