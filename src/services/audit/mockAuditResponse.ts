import type { AuditCallContext, RawAuditEvent, RawAuditResponse } from "./types";

/**
 * Build a structurally realistic raw audit response for development.
 *
 * Intentionally includes:
 *   - one parameter with result="fail" but awarded_score = 2 → validator
 *     must clamp to 0
 *   - one parameter with result="pass" but awarded_score < max_score →
 *     validator must clamp up to max_score
 *   - one parameter omitted entirely → validator must add it as not_found
 *
 * This proves the binary-scoring contract is enforced server-side, not by
 * trusting the model.
 */
export function generateMockAuditResponse(ctx: AuditCallContext): RawAuditResponse {
  const { call, parameters, transcript } = ctx;
  const fullLower = transcript.fullText.toLowerCase();

  // Lightweight heuristic markers — purely so the mock looks plausible.
  const greetedWell = /(good (morning|afternoon|evening)|thank you for calling|hello)/i.test(
    transcript.fullText,
  );
  const verified = /(date of birth|postcode|last four|account number)/i.test(transcript.fullText);
  const disclosed = /(disclosure|recorded|terms|t&c|conditions)/i.test(transcript.fullText);
  const closedWell = /(have a (great|good) day|thanks for (calling|your time))/i.test(
    transcript.fullText,
  );
  const dropped = call.disposition?.toLowerCase().includes("drop") ?? false;
  const escalated = call.disposition?.toLowerCase().includes("escalat") ?? false;

  // Skip one parameter on purpose; the validator must back-fill it.
  const skipIndex = parameters.length > 2 ? parameters.length - 1 : -1;

  const parameter_scores = parameters.flatMap((p, i) => {
    if (i === skipIndex) return [];

    // Decide pass/fail based on light text matching.
    const name = p.parameterName.toLowerCase();
    let pass = true;
    if (name.includes("greet") || name.includes("open")) pass = greetedWell;
    else if (name.includes("verif") || name.includes("identity")) pass = verified;
    else if (name.includes("disclos") || name.includes("compliance")) pass = disclosed;
    else if (name.includes("clos") || name.includes("recap")) pass = closedWell;
    else if (name.includes("empathy")) pass = !dropped;
    else if (name.includes("discover")) pass = transcript.segments.length >= 4;
    else if (name.includes("solution") || name.includes("explanation")) pass = !dropped && !escalated;
    else pass = transcript.segments.length >= 3;

    if (dropped) pass = false; // a dropped call rarely passes anything

    // Find a representative transcript segment to quote.
    const evidenceSeg =
      transcript.segments.find((s) => {
        const t = s.text.toLowerCase();
        if (name.includes("greet")) return /(hello|good morning|good afternoon|thank you for calling)/.test(t);
        if (name.includes("verif")) return /(date of birth|postcode|last four|account number|verify)/.test(t);
        if (name.includes("disclos")) return /(disclosure|recorded|terms)/.test(t);
        if (name.includes("clos")) return /(have a (great|good) day|thanks)/.test(t);
        if (name.includes("empathy")) return /(sorry|understand|apolog)/.test(t);
        return false;
      }) ?? null;

    const wrongPassPartial = pass && i === 0 && p.maxScore > 1; // deliberate partial score on a pass
    const wrongFailPositive = !pass && i === 1; // deliberate non-zero score on a fail

    const result: "pass" | "fail" = pass ? "pass" : "fail";
    const awarded_score = wrongPassPartial
      ? Math.max(1, Math.floor(p.maxScore / 2))
      : wrongFailPositive
        ? 2
        : pass
          ? p.maxScore
          : 0;

    return [
      {
        parameter_id: p.id,
        parameter_name: p.parameterName,
        max_score: p.maxScore,
        result,
        awarded_score,
        reason: pass
          ? `Evidence in transcript supports "${p.parameterName}".`
          : `No clear evidence of "${p.parameterName}" in transcript.`,
        evidence_text: evidenceSeg?.text ?? null,
        evidence_start_time_seconds: evidenceSeg ? Math.round(evidenceSeg.startMs / 1000) : null,
        evidence_end_time_seconds: evidenceSeg ? Math.round(evidenceSeg.endMs / 1000) : null,
        confidence_score: pass ? 0.85 : 0.65,
      },
    ];
  });

  const events: RawAuditEvent[] = [];
  const firstAgent = transcript.segments.find((s) => s.speaker === "AGENT");
  if (firstAgent && greetedWell) {
    events.push({
      event_type: "positive_moment",
      speaker: "agent",
      start_time_seconds: Math.round(firstAgent.startMs / 1000),
      end_time_seconds: Math.round(firstAgent.endMs / 1000),
      event_title: "Warm opening",
      event_description: "Agent greeted the customer professionally at the start of the call.",
      evidence_text: firstAgent.text,
      severity: "low",
      confidence_score: 0.9,
    });
  }
  if (!disclosed) {
    events.push({
      event_type: "compliance_issue",
      speaker: "agent",
      start_time_seconds: null,
      end_time_seconds: null,
      event_title: "Missing mandatory disclosure",
      event_description:
        "Transcript shows no required-disclosure script before closing the call.",
      evidence_text: null,
      severity: dropped ? "low" : "high",
      confidence_score: 0.7,
    });
  }
  if (escalated || /(complain|angry|upset|frustrated)/.test(fullLower)) {
    const seg = transcript.segments.find((s) => /(complain|angry|upset|frustrated)/.test(s.text.toLowerCase()));
    events.push({
      event_type: "possible_raised_tone",
      speaker: "customer",
      start_time_seconds: seg ? Math.round(seg.startMs / 1000) : null,
      end_time_seconds: seg ? Math.round(seg.endMs / 1000) : null,
      event_title: "Customer frustration detected (text only)",
      event_description:
        "Transcript suggests possible raised tone or frustration. Audio confirmation not available.",
      evidence_text: seg?.text ?? null,
      severity: "medium",
      confidence_score: 0.4,
    });
  }

  const totalMax = (parameter_scores as Array<{ max_score: number }>).reduce(
    (s, p) => s + (Number(p.max_score) || 0),
    0,
  );
  const totalAwarded = (parameter_scores as Array<{ awarded_score: number }>).reduce(
    (s, p) => s + (Number(p.awarded_score) || 0),
    0,
  );
  const pct = totalMax === 0 ? 0 : Math.round((totalAwarded / totalMax) * 1000) / 10;

  return {
    overall_score: totalAwarded,
    max_possible_score: totalMax,
    score_percentage: pct,
    sentiment: dropped ? "neutral" : escalated ? "negative" : closedWell ? "positive" : "neutral",
    agent_tone: dropped ? "unclear" : "professional",
    customer_emotion: escalated ? "frustrated" : closedWell ? "satisfied" : "neutral",
    has_compliance_issue: !disclosed,
    compliance_severity: !disclosed ? (dropped ? "low" : "high") : "none",
    ai_summary: dropped
      ? "Call dropped before completion. Limited evidence for scoring."
      : `Agent ${greetedWell ? "opened warmly" : "had a weak opening"}, ${
          verified ? "verified identity" : "did not verify identity"
        }, and ${closedWell ? "closed appropriately." : "closed weakly."}`,
    improvement_area: !disclosed
      ? "Read the mandatory disclosure script before closing the sale."
      : "Continue reinforcing identity verification on every call.",
    coaching_recommendation: !disclosed
      ? "Schedule a 1:1 to review the disclosure script and rehearse it on a mock call."
      : "Highlight this call as a coaching example in the next team huddle.",
    parameter_scores,
    events,
    agent_strengths: greetedWell ? ["warm and professional opening"] : [],
    agent_weaknesses: !disclosed ? ["missed required disclosure"] : [],
    customer_objections: escalated ? ["billing dispute"] : [],
    compliance_issues: !disclosed ? ["disclosure script not read"] : [],
    next_best_action: !disclosed
      ? "Re-train on disclosure script and re-audit a sample of this agent's calls next week."
      : "Use this call as a coaching example.",
  };
}
