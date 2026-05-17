import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
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
        fallbackUsed: transcript.fallbackUsed ?? false,
        fallbackReason: transcript.fallbackReason ?? null,
        attemptedModels: transcript.attemptedModels ?? Prisma.JsonNull,
        qualityFlags: transcript.qualityFlags ?? Prisma.JsonNull,
        fullText: transcript.fullText,
        generatedAt: new Date(),
      },
      create: {
        callId,
        source: "AI",
        language: transcript.language,
        modelUsed: transcript.modelUsed,
        fallbackUsed: transcript.fallbackUsed ?? false,
        fallbackReason: transcript.fallbackReason ?? null,
        attemptedModels: transcript.attemptedModels ?? Prisma.JsonNull,
        qualityFlags: transcript.qualityFlags ?? Prisma.JsonNull,
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
        channel: segment.channel ?? null,
        speakerSource: segment.speakerSource ?? null,
      })),
    });

    await tx.call.update({
      where: { id: callId },
      data: { language: transcript.language },
    });

    const isMock = /mock/i.test(transcript.modelUsed);
    await tx.callEvent.create({
      data: {
        callId,
        eventType: "TRANSCRIPT_READY",
        title: isMock ? "Mock transcription completed" : "Local STT transcription completed",
        description: `${transcript.segments.length} transcript segments saved (${transcript.modelUsed}).`,
        payload: {
          modelUsed: transcript.modelUsed,
          language: transcript.language,
          segmentCount: transcript.segments.length,
          fallbackUsed: transcript.fallbackUsed ?? false,
          fallbackReason: transcript.fallbackReason ?? null,
          qualityFlags: transcript.qualityFlags ?? [],
        },
      },
    });

    return saved;
  });
}
