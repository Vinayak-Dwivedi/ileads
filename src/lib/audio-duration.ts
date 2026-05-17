import "server-only";
import { execFile } from "node:child_process";

export async function probeAudioDurationSeconds(audioPath: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        audioPath,
      ],
      { timeout: 10_000 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const duration = Number(stdout.trim());
        resolve(Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null);
      },
    );
  });
}
