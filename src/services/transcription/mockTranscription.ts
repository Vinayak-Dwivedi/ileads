import type { TranscriptResult } from "./types";

const SEGMENTS: TranscriptResult["segments"] = [
  {
    sequence: 1,
    speaker: "AGENT",
    startMs: 0,
    endMs: 5200,
    text: "Namaste, mera naam Rahul hai, main iLeads support se bol raha hoon. Aapki call quality aur training ke liye record ho sakti hai.",
    confidenceScore: 0.94,
  },
  {
    sequence: 2,
    speaker: "CUSTOMER",
    startMs: 5600,
    endMs: 11800,
    text: "Haan, mujhe apne loan application ka status chahiye. Kal se portal par pending dikha raha hai aur mujhe thoda urgent hai.",
    confidenceScore: 0.91,
  },
  {
    sequence: 3,
    speaker: "AGENT",
    startMs: 12400,
    endMs: 18500,
    text: "Main samajh sakta hoon sir, aapko delay ki wajah se inconvenience ho rahi hai. Verification ke liye please registered mobile number confirm kar dijiye.",
    confidenceScore: 0.92,
  },
  {
    sequence: 4,
    speaker: "CUSTOMER",
    startMs: 19100,
    endMs: 23500,
    text: "Registered number 9876543210 hai. Lekin mujhe baar baar same details deni pad rahi hain, isliye frustration ho raha hai.",
    confidenceScore: 0.89,
  },
  {
    sequence: 5,
    speaker: "AGENT",
    startMs: 24200,
    endMs: 31800,
    text: "Sorry sir, main aapki concern note kar raha hoon. Application underwriting team ke paas hai. Expected update aaj shaam 6 baje tak aa jana chahiye.",
    confidenceScore: 0.93,
  },
  {
    sequence: 6,
    speaker: "CUSTOMER",
    startMs: 32500,
    endMs: 36900,
    text: "Theek hai, lekin agar update nahi aaya to mujhe escalation chahiye. Kya aap ticket number de sakte ho?",
    confidenceScore: 0.9,
  },
  {
    sequence: 7,
    speaker: "AGENT",
    startMs: 37500,
    endMs: 44400,
    text: "Ji, ticket number SR-48291 hai. Main escalation note add kar diya hai. Aapko SMS confirmation mil jayega.",
    confidenceScore: 0.92,
  },
  {
    sequence: 8,
    speaker: "AGENT",
    startMs: 45200,
    endMs: 51500,
    text: "Kya main aapki aur kisi tarah se help kar sakta hoon? Thank you for calling, aapka din shubh ho.",
    confidenceScore: 0.95,
  },
];

export function generateMockTranscript(): TranscriptResult {
  const fullText = SEGMENTS.map((segment) => {
    const speaker = segment.speaker === "AGENT" ? "Agent" : "Customer";
    return `${speaker}: ${segment.text}`;
  }).join("\n");

  return {
    language: "hi-IN",
    modelUsed: "mock-hinglish-transcriber-v1",
    fullText,
    segments: SEGMENTS,
  };
}
