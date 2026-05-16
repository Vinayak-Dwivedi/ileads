import "server-only";
import { prisma } from "@/lib/db";
import type { TranscriptResult } from "./types";

export async function saveTranscript(callId: string, transcript: TranscriptResult) {
  return prisma.$transaction(async (tx) => {
    await tx.transcriptSegment.deleteMany({
      where: { transcript: { callId } },
    });

    const saved = await tx.callTranscript.upsert({
      where: { callId },
      update: {
        source: "AI",
        language: transcript.language,
        modelUsed: transcript.modelUsed,
        fullText: transcript.fullText,
        generatedAt: new Date(),
      },
      create: {
        callId,
        source: "AI",
        language: transcript.language,
        modelUsed: transcript.modelUsed,
        fullText: transcript.fullText,
        generatedAt: new Date(),
      },
      select: { id: true },
    });

    await tx.transcriptSegment.createMany({
      data: transcript.segments.map((segment) => ({
        transcriptId: saved.id,
        sequence: segment.sequence,
        speaker: segment.speaker,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
        confidenceScore: segment.confidenceScore ?? null,
      })),
    });

    await tx.call.update({
      where: { id: callId },
      data: { language: transcript.language },
    });

    await tx.callEvent.create({
      data: {
        callId,
        eventType: "TRANSCRIPT_READY",
        title: "Mock transcription completed",
        description: `${transcript.segments.length} transcript segments saved.`,
        payload: {
          modelUsed: transcript.modelUsed,
          language: transcript.language,
          segmentCount: transcript.segments.length,
        },
      },
    });

    return saved;
  });
}
