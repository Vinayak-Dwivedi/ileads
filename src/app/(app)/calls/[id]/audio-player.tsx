"use client";

import { Play, RotateCcw, RotateCw, Volume2, Download } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatMmSs } from "@/lib/utils";

interface CallEventLite {
  id: string;
  type: string;
  occurredAt: string;
}

interface Props {
  recordingUrl: string | null;
  durationSeconds: number | null;
  events: CallEventLite[];
  callStartedAt: string | null;
  variant?: "full" | "compact";
}

function eventColor(type: string) {
  if (type.startsWith("AUDIT")) return "#2f6fed";
  if (type.startsWith("MANUAL")) return "#8b5cf6";
  if (type === "NOTE_ADDED") return "#f97316";
  if (type === "TRANSCRIPT_READY") return "#24a148";
  return "#94a3b8";
}

const WAVEFORM_BARS = 60;

function generateWaveform(seed: number): number[] {
  // Deterministic pseudo-random waveform so the SVG matches between SSR and CSR.
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < WAVEFORM_BARS; i += 1) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    out.push(0.25 + r * 0.6);
  }
  return out;
}

export function AudioPlayerCard({
  recordingUrl,
  durationSeconds,
  events,
  callStartedAt,
  variant = "full",
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [position, setPosition] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [detectedDuration, setDetectedDuration] = useState<number | null>(null);
  const totalSeconds = durationSeconds ?? detectedDuration ?? 0;

  const waveform = useMemo(() => generateWaveform(totalSeconds || 42), [totalSeconds]);

  // Compute the relative position (0–1) of each event along the timeline so
  // we can render them as markers. Falls back to evenly spaced when call
  // start time isn't known.
  const eventMarkers = useMemo(() => {
    if (events.length === 0 || !callStartedAt || !totalSeconds) {
      return events.map((e, i) => ({
        ...e,
        leftPct: events.length === 0 ? 0 : (i / Math.max(1, events.length - 1)) * 100,
      }));
    }
    const start = new Date(callStartedAt).getTime();
    return events.map((e) => {
      const dt = new Date(e.occurredAt).getTime();
      const seconds = Math.max(0, Math.min(totalSeconds, (dt - start) / 1000));
      return { ...e, leftPct: totalSeconds === 0 ? 0 : (seconds / totalSeconds) * 100 };
    });
  }, [events, callStartedAt, totalSeconds]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setPosition(el.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onLoadedMetadata = () => {
      if (Number.isFinite(el.duration)) setDetectedDuration(el.duration);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("loadedmetadata", onLoadedMetadata);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, []);

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => undefined);
    else el.pause();
  }

  function skip(delta: number) {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min((el.duration || totalSeconds), el.currentTime + delta));
  }

  function seek(nextSeconds: number) {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min((el.duration || totalSeconds), nextSeconds));
  }

  const playbackPct = totalSeconds > 0 ? (position / totalSeconds) * 100 : 0;

  const isCompact = variant === "compact";

  return (
    <section className={`html-card ${isCompact ? "p-4" : "mb-5 p-5"}`}>
      <div className={isCompact ? "flex items-center gap-3" : "grid items-center gap-5 py-4 lg:grid-cols-[auto_1fr_auto]"}>
        {isCompact ? (
          <>
            <button
              type="button"
              onClick={() => skip(-10)}
              className="relative grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-foreground hover:bg-muted"
              title="Skip back 10s"
            >
              <RotateCcw className="h-[18px] w-[18px]" />
              <span className="pointer-events-none absolute text-[8px] font-semibold text-foreground">10</span>
            </button>
            <button
              type="button"
              onClick={togglePlay}
              className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={!recordingUrl}
              title={isPlaying ? "Pause" : "Play"}
            >
              <Play className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => skip(10)}
              className="relative grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-foreground hover:bg-muted"
              title="Skip forward 10s"
            >
              <RotateCw className="h-[18px] w-[18px]" />
              <span className="pointer-events-none absolute text-[8px] font-semibold text-foreground">10</span>
            </button>
            <div className="flex-1">
              <input
                type="range"
                min={0}
                max={totalSeconds || 0}
                step={0.1}
                value={position}
                onChange={(e) => seek(Number(e.target.value))}
                className="w-full accent-[hsl(var(--primary))]"
                aria-label="Playback position"
              />
            </div>
            {recordingUrl ? (
              <a href={recordingUrl} className="html-btn" aria-label="Download audio" title="Download audio">
                <Download className="h-4 w-4" />
              </a>
            ) : (
              <span className="text-xs text-muted-foreground">No audio file</span>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => skip(-10)}
                  className="relative grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-foreground hover:bg-muted"
                  title="Skip back 10s"
                >
                  <RotateCcw className="h-[18px] w-[18px]" />
                  <span className="pointer-events-none absolute text-[8px] font-semibold text-foreground">10</span>
                </button>
                <button
                  type="button"
                  onClick={togglePlay}
                  className="grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  disabled={!recordingUrl}
                  title={isPlaying ? "Pause" : "Play"}
                >
                  <Play className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => skip(10)}
                  className="relative grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-foreground hover:bg-muted"
                  title="Skip forward 10s"
                >
                  <RotateCw className="h-[18px] w-[18px]" />
                  <span className="pointer-events-none absolute text-[8px] font-semibold text-foreground">10</span>
                </button>
              </div>
              <div className="text-center text-[13px] font-semibold text-muted-foreground tabular-nums">
                {formatMmSs(position)} / {totalSeconds ? formatMmSs(totalSeconds) : "--:--"}
              </div>
            </div>

            <div className="relative flex h-[60px] min-w-[280px] flex-1 items-center overflow-hidden rounded bg-[#e8eef7] px-2">
              <svg viewBox={`0 0 ${WAVEFORM_BARS * 14} 60`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                {waveform.map((amp, i) => {
                  const x = 6 + i * 14;
                  const half = amp * 24;
                  const active = (i / waveform.length) * 100 < playbackPct;
                  return (
                    <line
                      key={i}
                      x1={x}
                      y1={30 - half}
                      x2={x}
                      y2={30 + half}
                      stroke={active ? "#2f6fed" : "#cbd5e1"}
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  );
                })}
              </svg>
              {eventMarkers.map((m) => (
                <span
                  key={m.id}
                  className="absolute top-1 bottom-1 w-[2px]"
                  style={{ left: `${m.leftPct}%`, background: eventColor(m.type) }}
                  title={m.type}
                />
              ))}
              <div
                className="absolute top-0 bottom-0 w-px bg-blue-600"
                style={{ left: `${playbackPct}%` }}
              />
            </div>

            <div className="flex items-center gap-4">
              <Volume2 className="h-4 w-4 text-slate-500" />
              <div className="hidden h-1 w-20 rounded bg-[#dce3ee] md:block">
                <div className="h-1 w-[70%] rounded bg-[#2f6fed]" />
              </div>
              <span className="rounded-md border border-[#dce3ee] bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-700">
                1x
              </span>
              {recordingUrl ? (
                <a href={recordingUrl} className="html-btn">
                  <Download className="h-4 w-4" /> Download
                </a>
              ) : (
                <span className="text-xs text-slate-500">No audio file</span>
              )}
            </div>
          </>
        )}
      </div>

      {isCompact ? (
        <div className="mt-2 text-xs text-slate-500 tabular-nums">
          {formatMmSs(position)} / {totalSeconds ? formatMmSs(totalSeconds) : "--:--"}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500">
          <span className="text-slate-700 font-semibold">Events</span>
          <Legend color="#2f6fed" label="Audit" />
          <Legend color="#8b5cf6" label="Manual review" />
          <Legend color="#f97316" label="Note added" />
          <Legend color="#24a148" label="Transcript ready" />
          <Legend color="#94a3b8" label="System" />
          <span className="ml-auto text-slate-500">
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {recordingUrl ? (
        <audio ref={audioRef} src={recordingUrl} preload="none" className="hidden" />
      ) : null}
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
