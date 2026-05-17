import { generateMockTranscript } from "@/services/transcription/mockTranscription";
import type { SttEngine, SttResult, SttSegment } from "../types";

export class MockSttEngine implements SttEngine {
  readonly name = "mock";

  async transcribe(_audioPath: string): Promise<SttResult> {
    const transcript = generateMockTranscript();
    const segments: SttSegment[] = transcript.segments.map((s) => ({
      speaker: s.speaker,
      startMs: s.startMs,
      endMs: s.endMs,
      text: s.text,
      confidenceScore: s.confidenceScore ?? null,
    }));
    return {
      language: transcript.language,
      modelUsed: transcript.modelUsed,
      provider: "mock",
      fullText: transcript.fullText,
      segments,
      raw: { mocked: true },
    };
  }
}
