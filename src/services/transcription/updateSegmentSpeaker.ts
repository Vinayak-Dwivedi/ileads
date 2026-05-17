import "server-only";
import { prisma } from "@/lib/db";
import type { SpeakerRole } from "@prisma/client";

export interface UpdateSegmentSpeakerResult {
  ok: boolean;
  callId?: string;
  clientId?: string;
  oldSpeaker?: SpeakerRole;
  newSpeaker?: SpeakerRole;
  needsAuditRerun?: boolean;
  correctionId?: string;
  error?: string;
}

export async function updateSegmentSpeaker({
  segmentId,
  speaker,
  correctedBy,
}: {
  segmentId: string;
  speaker: SpeakerRole;
  correctedBy?: string | null;
}): Promise<UpdateSegmentSpeakerResult> {
  const segment = await prisma.transcriptSegment.findUnique({
    where: { id: segmentId },
    include: {
      transcript: {
        include: {
          call: {
            select: {
              id: true,
              clientId: true,
              aiAudits: {
                where: { isLatest: true },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  if (!segment) return { ok: false, error: "Transcript segment not found." };

  const callId = segment.transcript.call.id;
  const correctedAt = new Date();
  const correction = await prisma.$transaction(async (tx) => {
    const history = await tx.transcriptSegmentCorrection.create({
      data: {
        transcriptSegmentId: segment.id,
        callId,
        callTranscriptId: segment.transcriptId,
        oldSpeaker: segment.speaker,
        newSpeaker: speaker,
        oldSpeakerSource: segment.speakerSource,
        newSpeakerSource: "manual_segment_correction",
        segmentText: segment.text,
        startTimeSeconds: segment.startMs / 1000,
        endTimeSeconds: segment.endMs / 1000,
        rawSpeakerId: segment.channel,
        correctedAt,
        correctedBy: correctedBy ?? null,
      },
      select: { id: true },
    });
    await tx.transcriptSegment.update({
      where: { id: segment.id },
      data: {
        speaker,
        speakerSource: "manual_segment_correction",
      },
    });
    await tx.callTranscript.update({
      where: { id: segment.transcriptId },
      data: {
        speakerLabelsCorrected: true,
        speakerCorrectedAt: correctedAt,
        speakerCorrectionNote: "One or more speaker labels manually corrected.",
      },
    });
    await tx.callEvent.create({
      data: {
        callId,
        eventType: "OTHER",
        title: "Speaker label corrected",
        description: "Speaker for one transcript segment was manually updated.",
        payload: {
          action: "speaker_label_corrected",
          transcriptSegmentId: segment.id,
          oldSpeaker: segment.speaker,
          newSpeaker: speaker,
        },
      },
    });
    return history;
  });

  return {
    ok: true,
    callId,
    clientId: segment.transcript.call.clientId,
    oldSpeaker: segment.speaker,
    newSpeaker: speaker,
    needsAuditRerun: segment.transcript.call.aiAudits.length > 0,
    correctionId: correction.id,
  };
}
