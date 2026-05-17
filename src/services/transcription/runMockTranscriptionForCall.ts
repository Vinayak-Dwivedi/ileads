import "server-only";
import { prisma } from "@/lib/db";
import { shouldShowMockActions } from "@/services/stt";
import { generateMockTranscript } from "./mockTranscription";
import { saveTranscript } from "./saveTranscript";

export async function runMockTranscriptionForCall(callId: string, clientId: string) {
  const call = await prisma.call.findFirst({
    where: { id: callId, clientId },
    select: { id: true, audioPath: true, recordingUrl: true },
  });
  if (!call) throw new Error("Call not found.");
  if (!call.audioPath && !call.recordingUrl) throw new Error("Audio file required.");

  if (process.env.MOCK_STT === "false" && !shouldShowMockActions()) {
    throw new Error("Mock transcription is hidden. Set SHOW_MOCK_ACTIONS=true to enable it.");
  }

  const transcript = generateMockTranscript();
  const saved = await saveTranscript(call.id, transcript);
  return {
    transcriptId: saved.id,
    segmentCount: transcript.segments.length,
    modelUsed: transcript.modelUsed,
    language: transcript.language,
  };
}
