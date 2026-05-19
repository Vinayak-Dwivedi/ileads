"use client";

import { Download } from "lucide-react";
import {
  AudioPlayer,
  AudioPlayerControlBar,
  AudioPlayerDurationDisplay,
  AudioPlayerElement,
  AudioPlayerMuteButton,
  AudioPlayerPlayButton,
  AudioPlayerSeekBackwardButton,
  AudioPlayerSeekForwardButton,
  AudioPlayerTimeRange,
} from "@/components/ai-elements/audio-player";

interface Props {
  recordingUrl: string | null;
  durationSeconds: number | null;
}

export function AudioPlayerCard({ recordingUrl }: Props) {
  if (!recordingUrl) {
    return (
      <p className="text-xs text-slate-500">No audio uploaded for this call.</p>
    );
  }

  return (
    <div className="space-y-2">
      <AudioPlayer className="w-full">
        <AudioPlayerElement src={recordingUrl} preload="none" />
        <AudioPlayerControlBar>
          <AudioPlayerSeekBackwardButton />
          <AudioPlayerPlayButton />
          <AudioPlayerSeekForwardButton />
          <AudioPlayerTimeRange />
          <AudioPlayerDurationDisplay />
          <AudioPlayerMuteButton />
        </AudioPlayerControlBar>
      </AudioPlayer>
      <div className="flex items-center justify-end">
        <a
          href={recordingUrl}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          aria-label="Download audio"
        >
          <Download className="h-3 w-3" /> Download
        </a>
      </div>
    </div>
  );
}
