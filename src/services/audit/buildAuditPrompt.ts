import type { AuditCallContext } from "./types";

export const PROMPT_VERSION = "qms-audit-prompt-v1";

function fmt(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

/**
 * Build a compact, strict prompt for the AI auditor.
 *
 * Design rules:
 *   - The prompt must instruct the model to use BINARY scoring only —
 *     awarded_score == max_score for pass, awarded_score == 0 otherwise.
 *   - Output must be strict JSON, no prose around it.
 *   - The model must list every parameter (use "not_found" if the
 *     transcript gives no evidence).
 *   - Tone events that depend on audio (shouting, raised voice) must be
 *     reported as "possible_raised_tone" with lower confidence when there is
 *     no audio signal, since we only ship transcript text today.
 */
export function buildAuditPrompt(ctx: AuditCallContext): string {
  const { client, call, parameters, transcript } = ctx;

  const callerName = call.customerName ?? call.callerNumber ?? "Customer";
  const segmentsBlock = transcript.segments
    .map((s) => {
      const t = fmt(s.startMs / 1000);
      const label = s.speaker.toLowerCase();
      return `[${t}] ${label}: ${s.text}`;
    })
    .join("\n");

  const parametersBlock = parameters
    .map(
      (p, i) => `${i + 1}. parameter_id="${p.id}"
   name="${p.parameterName}"
   category="${p.parameterCategory}"
   max_score=${p.maxScore}
   description: ${p.parameterDescription}
   ai_instruction: ${p.aiInstruction || "(none)"}`,
    )
    .join("\n\n");

  return `You are an expert contact-centre Quality Assurance auditor for ${client.name}.
You will audit a single recorded customer-service call and return a strict JSON
report. Be objective, evidence-driven, and conservative.

## Hard rules

1. SCORING IS BINARY.
   - If the parameter description is **clearly fulfilled** by the agent's
     behaviour in the transcript, set "result": "pass" and
     "awarded_score" = max_score.
   - If it is not fulfilled, is only partially fulfilled, is unclear, is
     missing, or you cannot find supporting evidence in the transcript, set
     "result": "fail" or "not_found" and "awarded_score" = 0.
   - NEVER award a partial score. NEVER award max_score on a fail/not_found.
2. EVIDENCE IS MANDATORY for any pass and for any flagged event. Quote a
   short, exact-ish snippet from the transcript and provide the segment
   timestamp in seconds (start, optionally end).
3. Cover every parameter exactly once. If you don't have evidence for one,
   include it with "result": "not_found", "awarded_score": 0.
4. Output JSON ONLY. No markdown, no commentary outside the JSON object.

## Detection guidance

- compliance_severity must reflect the worst compliance issue you found.
- has_compliance_issue is true iff compliance_severity is at least "low".
- detect:
  - rude language, shouting / possible raised tone, interruptions
  - empathy gaps, script deviation, customer objections, escalation risk
  - positive moments (warm greeting, strong recovery)
- TONE LIMITATION (important): you are reading **transcript text only**, no
  audio. You cannot reliably claim the agent or customer shouted, raised
  their voice, or was rude purely from text. If the transcript only hints
  at tone, emit the event with event_type "possible_raised_tone" or
  "tone_issue" and confidence_score <= 0.5. Reserve event_type
  "rude_language" for verbatim profanity / clearly hostile wording.

## Schema (return JSON matching exactly this shape)

{
  "overall_score": number,                                 // sum of awarded_score across all parameters
  "max_possible_score": number,                            // sum of max_score across all parameters
  "score_percentage": number,                              // overall_score / max_possible_score * 100
  "sentiment": "positive" | "neutral" | "negative" | "mixed",
  "agent_tone": string,                                    // short phrase, e.g. "warm professional"
  "customer_emotion": string,                              // short phrase
  "has_compliance_issue": boolean,
  "compliance_severity": "none" | "low" | "medium" | "high" | "critical",
  "ai_summary": string,                                    // 2–4 sentences
  "improvement_area": string,                              // 1–2 sentences
  "coaching_recommendation": string,                       // 1–2 sentences
  "parameter_scores": [
    {
      "parameter_id": string,                              // copy verbatim from the list above
      "parameter_name": string,
      "max_score": number,
      "result": "pass" | "fail" | "not_found",
      "awarded_score": number,                             // BINARY: max_score or 0
      "reason": string,
      "evidence_text": string,
      "evidence_start_time_seconds": number | null,
      "evidence_end_time_seconds":   number | null,
      "confidence_score": number                           // 0..1
    }
  ],
  "events": [
    {
      "event_type": string,                                // see list above
      "speaker": "agent" | "customer" | "both" | "unknown",
      "start_time_seconds": number | null,
      "end_time_seconds":   number | null,
      "event_title": string,
      "event_description": string,
      "evidence_text": string,
      "severity": "low" | "medium" | "high" | "critical",
      "confidence_score": number                           // 0..1
    }
  ],
  "agent_strengths":     string[],
  "agent_weaknesses":    string[],
  "customer_objections": string[],
  "compliance_issues":   string[],
  "next_best_action":    string
}

## Call

call_id:        ${call.externalCallId ?? call.id}
client:         ${client.name}
campaign:       ${call.campaignName ?? "—"}
agent:          ${call.agentName ?? "—"}
team:           ${call.teamName ?? "—"}
direction:      ${call.direction}
disposition:    ${call.disposition ?? "—"}
language:       ${call.language ?? "—"}
caller:         ${call.callerNumber ?? "—"}
callee:         ${call.calleeNumber ?? "—"}
customer_name:  ${callerName}
duration:       ${fmt(call.durationSeconds ?? null)}

## Parameters to audit (${parameters.length})

${parametersBlock || "(no active parameters configured)"}

## Transcript (segment timestamps in mm:ss)

${segmentsBlock || transcript.fullText || "(no transcript available)"}

Return the JSON object now.`;
}
