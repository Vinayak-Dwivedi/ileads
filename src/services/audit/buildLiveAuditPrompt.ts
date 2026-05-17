import type { AuditCallContext } from "./types";

export const LIVE_PROMPT_VERSION = "qms-live-audit-prompt-v2";

export const PROMPT_PLACEHOLDERS = {
  clientName: "{{CLIENT_NAME}}",
  parameters: "{{PARAMETERS}}",
  callMetadata: "{{CALL_METADATA}}",
  transcriptSegments: "{{TRANSCRIPT_SEGMENTS}}",
  jsonSchema: "{{JSON_SCHEMA}}",
  binaryScoringRules: "{{BINARY_SCORING_RULES}}",
} as const;

function fmtSeconds(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function buildParametersBlock(
  parameters: Array<{
    id: string;
    parameterCategory: string;
    parameterName: string;
    parameterDescription: string;
    maxScore: number;
    aiInstruction: string | null;
  }>,
): string {
  if (parameters.length === 0) return "(no active parameters configured)";
  return parameters
    .map(
      (p, i) =>
        `${i + 1}. parameter_id="${p.id}"
   name="${p.parameterName}"
   category="${p.parameterCategory}"
   max_score=${p.maxScore}
   description: ${p.parameterDescription}
   ai_instruction: ${p.aiInstruction || "(none)"}`,
    )
    .join("\n\n");
}

function buildCallMetadataBlock(call: AuditCallContext["call"], customerName: string): string {
  return `call_id:        ${call.externalCallId ?? call.id}
campaign:       ${call.campaignName ?? "—"}
agent:          ${call.agentName ?? "—"}
team:           ${call.teamName ?? "—"}
direction:      ${call.direction}
disposition:    ${call.disposition ?? "—"}
language:       ${call.language ?? "—"}
caller:         ${call.callerNumber ?? "—"}
callee:         ${call.calleeNumber ?? "—"}
customer_name:  ${customerName}
duration:       ${fmtSeconds(call.durationSeconds ?? null)}`;
}

function buildTranscriptBlock(transcript: AuditCallContext["transcript"]): string {
  if (transcript.segments.length === 0) return transcript.fullText || "(no transcript available)";
  const lines = transcript.segments
    .map((s) => {
      const startSec = s.startMs / 1000;
      const endSec = s.endMs / 1000;
      const label = formatSpeakerLabel(s.speaker);
      return `[${fmtSeconds(startSec)}-${fmtSeconds(endSec)} | start=${startSec.toFixed(2)}s] ${label}: ${s.text}`;
    })
    .join("\n");
  return transcript.speakerLabelNote ? `${transcript.speakerLabelNote}\n${lines}` : lines;
}

function formatSpeakerLabel(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === "agent") return "Agent";
  if (normalized === "customer") return "Customer";
  if (normalized === "system") return "System";
  return "Unknown";
}

export const BINARY_SCORING_RULES = `Rules:
1. Use ONLY the provided transcript and parameters. Do not invent facts.
2. Do not assume anything not present in the transcript.
3. SCORING IS BINARY for every parameter:
   - "pass" -> awarded_score = max_score (full points)
   - "fail" -> awarded_score = 0
   - "not_found" -> awarded_score = 0
   - NEVER award partial scores.
4. If evidence for a parameter is missing in the transcript, mark it "not_found" with awarded_score = 0.
5. For every "fail" or "not_found", quote the supporting transcript snippet
   in evidence_text if any exists, or set evidence_text to "evidence not found".
6. Identify compliance issues, agent tone issues, customer emotion,
   empathy gaps, customer objections, script deviation, and possible rude
   language or possible raised tone — only if the transcript clearly
   supports it. You only see TEXT, not audio: if tone is uncertain, use
   event_type "possible_raised_tone" or "tone_issue" with confidence_score
   <= 0.5.
7. Keep Hindi / Hinglish context in mind: short greetings ("namaste",
   "haan ji", "theek hai"), code-switching, and informal phrasing are
   normal.
8. Return ONLY valid JSON matching the schema below. No markdown. No
   surrounding prose. No code fences. Strings must be valid JSON strings.
9. parameter_id values MUST be copied verbatim from the parameter list.
10. Cover EVERY parameter exactly once.
11. Timestamps are in SECONDS from call start (use numeric values from the
    "start=" field on each transcript line, or null if you cannot tell).`;

export const JSON_OUTPUT_SCHEMA = `{
  "overall_score": 0,
  "max_possible_score": 0,
  "score_percentage": 0,
  "sentiment": "positive | neutral | negative | mixed",
  "agent_tone": "professional | calm | empathetic | rushed | confused | rude | mixed | unknown",
  "customer_emotion": "calm | interested | confused | frustrated | angry | hesitant | mixed | unknown",
  "has_compliance_issue": false,
  "compliance_severity": "none | low | medium | high | critical",
  "ai_summary": "",
  "improvement_area": "",
  "coaching_recommendation": "",
  "parameter_scores": [
    {
      "parameter_id": "",
      "parameter_name": "",
      "max_score": 0,
      "result": "pass | fail | not_found",
      "awarded_score": 0,
      "reason": "",
      "evidence_text": "",
      "evidence_start_time_seconds": null,
      "evidence_end_time_seconds": null,
      "confidence_score": 0
    }
  ],
  "events": [
    {
      "event_type": "compliance_issue | tone_issue | customer_objection | empathy_gap | script_deviation | positive_moment | escalation_risk | confusion | interruption",
      "speaker": "agent | customer | both | unknown",
      "start_time_seconds": null,
      "end_time_seconds": null,
      "event_title": "",
      "event_description": "",
      "evidence_text": "",
      "severity": "low | medium | high | critical",
      "confidence_score": 0
    }
  ],
  "agent_strengths": [],
  "agent_weaknesses": [],
  "customer_objections": [],
  "compliance_issues": [],
  "next_best_action": ""
}`;

/**
 * Default editable prompt template used when a client has no custom
 * `client_audit_prompts` row. Contains placeholders so it can be reviewed and
 * edited on the parameters detail page without seeing a real transcript.
 */
export function buildDefaultPromptTemplate(): string {
  return `You are a senior contact-centre Quality Assurance auditor for ${PROMPT_PLACEHOLDERS.clientName}.

${PROMPT_PLACEHOLDERS.binaryScoringRules}

## Call metadata

${PROMPT_PLACEHOLDERS.callMetadata}

## Audit parameters

${PROMPT_PLACEHOLDERS.parameters}

## Transcript segments (mm:ss | start=Ns | speaker: text)

${PROMPT_PLACEHOLDERS.transcriptSegments}

## Output JSON schema (return EXACTLY this shape, valid JSON, no markdown)

${PROMPT_PLACEHOLDERS.jsonSchema}

Return the JSON object now. No markdown. No commentary.`;
}

export interface LiveAuditPromptMessages {
  system: string;
  user: string;
  /** Resolved final prompt actually sent to the model (single string preview). */
  resolved: string;
  /** Whether a custom client prompt template was used. */
  usedCustomTemplate: boolean;
}

/**
 * Render the prompt with placeholders substituted.
 *
 * The system message holds the rules (binary scoring + output discipline).
 * The user message holds the resolved template (metadata + parameters +
 * transcript + schema).
 */
export function buildLiveAuditPrompt(
  ctx: AuditCallContext,
  customTemplate: string | null = null,
): LiveAuditPromptMessages {
  const { client, call, parameters, transcript } = ctx;
  const customerName = call.customerName ?? call.callerNumber ?? "Customer";

  const replacements: Record<string, string> = {
    [PROMPT_PLACEHOLDERS.clientName]: client.name,
    [PROMPT_PLACEHOLDERS.callMetadata]: buildCallMetadataBlock(call, customerName),
    [PROMPT_PLACEHOLDERS.parameters]: buildParametersBlock(
      parameters.map((p) => ({
        id: p.id,
        parameterCategory: p.parameterCategory,
        parameterName: p.parameterName,
        parameterDescription: p.parameterDescription,
        maxScore: p.maxScore,
        aiInstruction: p.aiInstruction,
      })),
    ),
    [PROMPT_PLACEHOLDERS.transcriptSegments]: buildTranscriptBlock(transcript),
    [PROMPT_PLACEHOLDERS.jsonSchema]: JSON_OUTPUT_SCHEMA,
    [PROMPT_PLACEHOLDERS.binaryScoringRules]: BINARY_SCORING_RULES,
  };

  const templateRaw = (customTemplate && customTemplate.trim().length > 0
    ? customTemplate
    : buildDefaultPromptTemplate());

  // Safe-completion: if a custom template is missing any of the four
  // mandatory sections (parameters, transcript, JSON schema, binary rules),
  // append them so the audit cannot be silently broken by a bad edit.
  let template = templateRaw;
  const appendIfMissing: Array<{ placeholder: string; section: string }> = [
    {
      placeholder: PROMPT_PLACEHOLDERS.binaryScoringRules,
      section: `\n\n## Scoring rules\n\n${PROMPT_PLACEHOLDERS.binaryScoringRules}`,
    },
    {
      placeholder: PROMPT_PLACEHOLDERS.parameters,
      section: `\n\n## Audit parameters\n\n${PROMPT_PLACEHOLDERS.parameters}`,
    },
    {
      placeholder: PROMPT_PLACEHOLDERS.transcriptSegments,
      section: `\n\n## Transcript segments (mm:ss | start=Ns | speaker: text)\n\n${PROMPT_PLACEHOLDERS.transcriptSegments}`,
    },
    {
      placeholder: PROMPT_PLACEHOLDERS.jsonSchema,
      section: `\n\n## Output JSON schema (return EXACTLY this shape, valid JSON, no markdown)\n\n${PROMPT_PLACEHOLDERS.jsonSchema}`,
    },
  ];
  for (const { placeholder, section } of appendIfMissing) {
    if (!template.includes(placeholder)) template += section;
  }
  // {{CLIENT_NAME}} and {{CALL_METADATA}} are nice-to-have but not load-bearing
  // for binary scoring; substitute anyway if present.

  let resolved = template;
  for (const [token, value] of Object.entries(replacements)) {
    resolved = resolved.split(token).join(value);
  }

  const system = `You are a strict, evidence-driven contact-centre QA auditor.
Follow the user-message instructions exactly. Output valid JSON only. No
markdown, no code fences, no surrounding prose. SCORING IS BINARY: pass =
max_score, fail/not_found = 0. Never invent transcript content.`;

  return {
    system,
    user: resolved,
    resolved,
    usedCustomTemplate: customTemplate !== null && customTemplate.trim().length > 0,
  };
}

/**
 * Generate the default prompt *template* for a client (placeholders intact),
 * for the editor preview on the parameters page. Does not contain any
 * call transcript — just the template that audits use.
 */
export function generateDefaultPromptForClient(input: {
  clientName: string;
  parameters: Array<{
    id: string;
    parameterCategory: string;
    parameterName: string;
    parameterDescription: string;
    maxScore: number;
    aiInstruction: string | null;
  }>;
}): string {
  // Render the default template with CLIENT_NAME + PARAMETERS already
  // substituted, but leave CALL_METADATA, TRANSCRIPT_SEGMENTS, JSON_SCHEMA,
  // and BINARY_SCORING_RULES as placeholders so the editor preview shows
  // exactly what audit time will inject.
  let t = buildDefaultPromptTemplate();
  t = t.split(PROMPT_PLACEHOLDERS.clientName).join(input.clientName);
  t = t.split(PROMPT_PLACEHOLDERS.parameters).join(buildParametersBlock(input.parameters));
  t = t.split(PROMPT_PLACEHOLDERS.jsonSchema).join(JSON_OUTPUT_SCHEMA);
  t = t.split(PROMPT_PLACEHOLDERS.binaryScoringRules).join(BINARY_SCORING_RULES);
  return t;
}
