export type CanonicalSpeakerRole = "agent" | "customer" | "unknown";
export type SpeakerMappingMode = "fixed" | "heuristic" | "raw";
export type SpeakerMappingConfidence = "high" | "medium" | "low";

export interface DiarizedSpeakerSegment {
  speakerId: string | null | undefined;
  text: string;
}

export interface SpeakerRoleScores {
  agent: number;
  customer: number;
  segments: number;
  words: number;
}

export interface SpeakerRoleInference {
  mapping: Record<string, CanonicalSpeakerRole>;
  confidence: SpeakerMappingConfidence;
  reason: string;
  scores: Record<string, SpeakerRoleScores>;
  mode: SpeakerMappingMode;
}

export interface InferSpeakerRolesOptions {
  mode: SpeakerMappingMode;
  firstSpeaker: CanonicalSpeakerRole;
  secondSpeaker: CanonicalSpeakerRole;
}

const AGENT_CUES: Array<RegExp | string> = [
  "good morning",
  "namaste",
  "गुड मॉर्निंग",
  "नमस्ते",
  "airtel",
  "एयरटेल",
  "company se",
  "कंपनी",
  "customer care",
  "sir",
  "सर",
  "madam",
  "मैडम",
  "verification",
  "वेरिफिकेशन",
  "plan",
  "प्लान",
  "offer",
  "ऑफर",
  "ticket",
  "टिकट",
  "complaint",
  "schedule",
  "शेड्यूल",
  "hold",
  "होल्ड",
  "check",
  "चेक",
  "main bata",
  "मैं बता",
  "बात कर रही",
  "बात कर रहा",
  "डिवाइस",
  "राउटर",
  "रिटर्न",
  "बुक",
  "पॉलिसी",
  "aapko",
  "आपको",
  "please",
  "प्लीज",
  "kripya",
  "कृपया",
  /main\s+\S{1,30}\s+bol\s+rah[ai]/,
  /main\s+.*karwa\s+det[ai]/,
  /main\s+.*kar\s+det[ai]/,
];

const CUSTOMER_CUES: Array<RegExp | string> = [
  "mera",
  "मेरा",
  "meri",
  "मेरी",
  "maine",
  "मैंने",
  "mujhe",
  "मुझे",
  "mere ghar",
  "मेरे घर",
  "mera connection",
  "मेरा कनेक्शन",
  "problem",
  "प्रॉब्लम",
  "समस्या",
  "pareshan",
  "परेशान",
  "complaint",
  "शिकायत",
  "cancel",
  "कैंसल",
  "head office",
  "हेड ऑफिस",
  "nahi chahiye",
  "नहीं चाहिए",
  "kyun",
  "क्यों",
  "kitna",
  "कितना",
  "kaise",
  "कैसे",
  "kab",
  "कब",
  "kya",
  "क्या",
  "nahi",
  "नहीं",
  "डिस्टर्ब",
  "जमा",
];

export function inferSpeakerRoles(
  segments: DiarizedSpeakerSegment[],
  options: InferSpeakerRolesOptions,
): SpeakerRoleInference {
  const speakerIds = orderedSpeakerIds(segments);
  const scores = scoreSpeakers(segments);

  if (options.mode === "raw") {
    return {
      mapping: Object.fromEntries(speakerIds.map((id) => [id, "unknown"])),
      confidence: "high",
      reason: "Raw Sarvam speaker ids preserved by configuration.",
      scores,
      mode: "raw",
    };
  }

  if (options.mode === "fixed") {
    return fixedInference(speakerIds, scores, options, "fixed");
  }

  const heuristic = heuristicInference(speakerIds, scores, options);
  if (heuristic.confidence !== "low") return heuristic;

  const fallback = fixedInference(speakerIds, scores, options, "heuristic");
  return {
    ...fallback,
    confidence: "low",
    reason: `Heuristic confidence was low; used configured fallback mapping. ${heuristic.reason}`,
  };
}

function orderedSpeakerIds(segments: DiarizedSpeakerSegment[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const segment of segments) {
    const id = normalizeSpeakerId(segment.speakerId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function normalizeSpeakerId(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw || raw === "unknown") return null;
  return raw
    .replace(/^speaker[_\s-]?/, "")
    .replace(/^spk[_\s-]?/, "")
    .trim();
}

function scoreSpeakers(segments: DiarizedSpeakerSegment[]): Record<string, SpeakerRoleScores> {
  const scores: Record<string, SpeakerRoleScores> = {};
  for (const segment of segments) {
    const speakerId = normalizeSpeakerId(segment.speakerId);
    if (!speakerId) continue;
    const text = normalizeText(segment.text);
    const entry = scores[speakerId] ?? { agent: 0, customer: 0, segments: 0, words: 0 };
    entry.agent += scoreText(text, AGENT_CUES);
    entry.customer += scoreText(text, CUSTOMER_CUES);
    entry.segments += 1;
    entry.words += text.split(/\s+/).filter(Boolean).length;
    scores[speakerId] = entry;
  }
  return scores;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function scoreText(text: string, cues: Array<RegExp | string>): number {
  if (!text) return 0;
  let score = 0;
  for (const cue of cues) {
    if (typeof cue === "string") {
      score += countOccurrences(text, cue);
    } else if (cue.test(text)) {
      score += 2;
    }
  }
  return score;
}

function countOccurrences(text: string, cue: string): number {
  let count = 0;
  let index = 0;
  while (index < text.length) {
    const next = text.indexOf(cue, index);
    if (next === -1) break;
    count += 1;
    index = next + cue.length;
  }
  return count;
}

function fixedInference(
  speakerIds: string[],
  scores: Record<string, SpeakerRoleScores>,
  options: InferSpeakerRolesOptions,
  mode: SpeakerMappingMode,
): SpeakerRoleInference {
  const mapping: Record<string, CanonicalSpeakerRole> = {};
  speakerIds.forEach((id, index) => {
    if (index === 0) mapping[id] = options.firstSpeaker;
    else if (index === 1) mapping[id] = options.secondSpeaker;
    else mapping[id] = "unknown";
  });
  return {
    mapping,
    confidence: speakerIds.length >= 2 ? "medium" : "low",
    reason:
      speakerIds.length >= 2
        ? `Configured fallback mapping applied to first ${Math.min(2, speakerIds.length)} observed speakers.`
        : "Only one diarized speaker was observed; configured fallback has low confidence.",
    scores,
    mode,
  };
}

function heuristicInference(
  speakerIds: string[],
  scores: Record<string, SpeakerRoleScores>,
  options: InferSpeakerRolesOptions,
): SpeakerRoleInference {
  if (speakerIds.length === 0) {
    return {
      mapping: {},
      confidence: "low",
      reason: "No Sarvam diarized speaker ids were available.",
      scores,
      mode: "heuristic",
    };
  }

  if (speakerIds.length === 1) {
    const id = speakerIds[0];
    const score = scores[id] ?? { agent: 0, customer: 0, segments: 0, words: 0 };
    const role =
      score.agent >= score.customer + 2
        ? "agent"
        : score.customer >= score.agent + 2
          ? "customer"
          : options.firstSpeaker;
    return {
      mapping: { [id]: role },
      confidence: "low",
      reason: "Only one diarized speaker was observed, so role assignment cannot be calibrated.",
      scores,
      mode: "heuristic",
    };
  }

  const agentRank = [...speakerIds].sort((a, b) => roleMargin(scores[b], "agent") - roleMargin(scores[a], "agent"));
  const customerRank = [...speakerIds].sort((a, b) => roleMargin(scores[b], "customer") - roleMargin(scores[a], "customer"));
  const agentId = agentRank[0];
  let customerId = customerRank[0];
  if (customerId === agentId && customerRank.length > 1) customerId = customerRank[1];

  const mapping: Record<string, CanonicalSpeakerRole> = Object.fromEntries(
    speakerIds.map((id) => [id, "unknown" as CanonicalSpeakerRole]),
  );
  mapping[agentId] = "agent";
  if (customerId !== agentId) mapping[customerId] = "customer";

  if (speakerIds.length === 2 && customerId === agentId) {
    const otherId = speakerIds.find((id) => id !== agentId);
    if (otherId) mapping[otherId] = mapping[agentId] === "agent" ? "customer" : "agent";
  }

  const agentScore = scores[agentId]?.agent ?? 0;
  const customerScore = scores[customerId]?.customer ?? 0;
  const agentMargin = roleMargin(scores[agentId], "agent");
  const customerMargin = roleMargin(scores[customerId], "customer");
  const distinct = mapping[agentId] === "agent" && Object.values(mapping).includes("customer");
  const totalCueScore = Object.values(scores).reduce((sum, s) => sum + s.agent + s.customer, 0);

  let confidence: SpeakerMappingConfidence = "low";
  if (distinct && agentMargin >= 3 && customerMargin >= 1 && totalCueScore >= 6) {
    confidence = "high";
  } else if (distinct && (agentScore >= 3 || customerScore >= 2 || totalCueScore >= 4)) {
    confidence = "medium";
  }

  return {
    mapping,
    confidence,
    reason: `Heuristic scores selected speaker ${agentId} as agent and speaker ${customerId} as customer.`,
    scores,
    mode: "heuristic",
  };
}

function roleMargin(score: SpeakerRoleScores | undefined, role: "agent" | "customer"): number {
  if (!score) return 0;
  return role === "agent" ? score.agent - score.customer : score.customer - score.agent;
}
