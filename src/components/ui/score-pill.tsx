import { Pill } from "@/components/ui/pill";

export function ScorePill({ value }: { value: number | null | undefined }) {
  if (value == null || Number.isNaN(value)) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  const tone = value >= 85 ? "green" : value >= 60 ? "yellow" : "red";
  return <Pill tone={tone}>{Math.round(value)}%</Pill>;
}

export function AuditStatusPill({ status }: { status: string | null | undefined }) {
  const v = (status ?? "").toUpperCase();
  if (v === "COMPLETED") return <Pill tone="blue">Audited</Pill>;
  if (v === "PENDING") return <Pill tone="orange">Pending</Pill>;
  if (v === "UPLOADED") return <Pill tone="orange">Queued</Pill>;
  if (v === "TRANSCRIBING") return <Pill tone="purple">Transcribing</Pill>;
  if (v === "AUDITING") return <Pill tone="purple">Auditing</Pill>;
  if (v === "RUNNING") return <Pill tone="purple">Running</Pill>;
  if (v === "IN_PROGRESS") return <Pill tone="purple">In Review</Pill>;
  if (v === "FAILED") return <Pill tone="red">Failed</Pill>;
  return <Pill tone="slate">{status ?? "—"}</Pill>;
}
