export interface SttSegment {
  speaker?: "AGENT" | "CUSTOMER" | "UNKNOWN";
  startMs: number;
  endMs: number;
  text: string;
  confidenceScore?: number | null;
}

export interface SttResult {
  language: string;
  modelUsed: string;
  fullText: string;
  segments: SttSegment[];
}

export interface SttProvider {
  transcribe(audioPath: string): Promise<SttResult>;
}
