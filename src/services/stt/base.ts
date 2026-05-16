import type { SttProvider, SttResult } from "./types";

export class LiveSttNotConfiguredProvider implements SttProvider {
  async transcribe(_audioPath: string): Promise<SttResult> {
    throw new Error("Live STT is not configured yet.");
  }
}
