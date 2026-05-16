import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function daysAgo(n: number, hour = 10, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  const password = process.env.APP_PASSWORD ?? "demo-password";
  const passwordHash = await bcrypt.hash(password, 10);

  // --- Tenant: a single demo client with seeded password access -----------
  const client = await prisma.client.upsert({
    where: { slug: "acme-bpo" },
    update: {},
    create: {
      name: "Acme BPO",
      slug: "acme-bpo",
      industry: "Outsourced contact centre",
      contactEmail: "ops@acmebpo.example",
    },
  });

  await prisma.clientAccess.upsert({
    where: { id: `${client.id}-default-access` },
    update: { passwordHash, isActive: true },
    create: {
      id: `${client.id}-default-access`,
      clientId: client.id,
      label: "Workspace password",
      passwordHash,
    },
  });

  // --- Campaigns -----------------------------------------------------------
  const campaigns = await Promise.all(
    [
      {
        slug: "credit-card-sales",
        name: "Credit Card Sales",
        description: "Outbound credit-card cross-sell campaign.",
        startedOn: daysAgo(120),
      },
      {
        slug: "customer-retention",
        name: "Customer Retention",
        description: "Inbound retention desk for churn-risk customers.",
        startedOn: daysAgo(60),
      },
      {
        slug: "support-tier-1",
        name: "Tier-1 Support",
        description: "Inbound tier-1 product support.",
        startedOn: daysAgo(200),
      },
    ].map((c) =>
      prisma.campaign.upsert({
        where: { id: `${client.id}-${c.slug}` },
        update: {},
        create: {
          id: `${client.id}-${c.slug}`,
          clientId: client.id,
          name: c.name,
          description: c.description,
          startedOn: c.startedOn,
        },
      })
    )
  );

  // --- Teams ---------------------------------------------------------------
  const teams = await Promise.all(
    [
      { slug: "team-alpha", name: "Team Alpha", description: "Premier accounts." },
      { slug: "team-bravo", name: "Team Bravo", description: "Acquisitions." },
      { slug: "team-charlie", name: "Team Charlie", description: "Retention specialists." },
    ].map((t) =>
      prisma.team.upsert({
        where: { id: `${client.id}-${t.slug}` },
        update: {},
        create: {
          id: `${client.id}-${t.slug}`,
          clientId: client.id,
          name: t.name,
          description: t.description,
        },
      })
    )
  );

  // --- Agents --------------------------------------------------------------
  const agents = await Promise.all(
    [
      { slug: "agent-priya", name: "Priya Shah", code: "ACM-001", team: teams[0] },
      { slug: "agent-marcus", name: "Marcus Lee", code: "ACM-002", team: teams[0] },
      { slug: "agent-amelia", name: "Amelia Rivera", code: "ACM-003", team: teams[1] },
      { slug: "agent-david", name: "David Okafor", code: "ACM-004", team: teams[1] },
      { slug: "agent-naomi", name: "Naomi Chen", code: "ACM-005", team: teams[2] },
    ].map((a) =>
      prisma.agent.upsert({
        where: { id: `${client.id}-${a.slug}` },
        update: {},
        create: {
          id: `${client.id}-${a.slug}`,
          clientId: client.id,
          teamId: a.team.id,
          name: a.name,
          employeeCode: a.code,
          email: `${a.slug.replace("agent-", "")}@acmebpo.example`,
          hiredOn: daysAgo(300),
        },
      })
    )
  );

  // --- Client parameters ---------------------------------------------------
  const parameterSeeds: Array<{
    slug: string;
    category: string;
    name: string;
    description: string;
    maxScore: number;
    aiInstruction: string;
    order: number;
  }> = [
    {
      slug: "opening-greeting",
      category: "Opening",
      name: "Standard greeting",
      description:
        "Agent must greet the customer, state their name, and identify the company within the first 15 seconds.",
      maxScore: 10,
      aiInstruction:
        "Mark as fulfilled only if the agent's first turn includes a salutation, their name, and the company name.",
      order: 10,
    },
    {
      slug: "identity-verification",
      category: "Compliance",
      name: "Identity verification",
      description:
        "Agent must verify customer identity using at least two pieces of information before discussing account details.",
      maxScore: 20,
      aiInstruction:
        "Look for the agent asking for two distinct identifiers (name + DOB / postcode / last 4 digits) before any account discussion.",
      order: 20,
    },
    {
      slug: "needs-discovery",
      category: "Discovery",
      name: "Needs discovery",
      description:
        "Agent asks at least one open-ended question to understand the customer's situation.",
      maxScore: 15,
      aiInstruction: "Open-ended = starts with What/How/Why/Tell me. Closed yes/no does not count.",
      order: 30,
    },
    {
      slug: "solution-clarity",
      category: "Solution",
      name: "Clear solution explanation",
      description:
        "Agent explains the proposed product or solution clearly, including key terms and any obligations.",
      maxScore: 15,
      aiInstruction:
        "Fulfilled if the agent describes what the customer is getting, any cost, and any commitment period.",
      order: 40,
    },
    {
      slug: "compliance-disclosures",
      category: "Compliance",
      name: "Required disclosures",
      description:
        "Agent reads required regulatory disclosures verbatim before closing the sale.",
      maxScore: 20,
      aiInstruction:
        "Fulfilled only if the disclosures appear before any explicit consent/commitment from the customer.",
      order: 50,
    },
    {
      slug: "empathy",
      category: "Soft skills",
      name: "Empathy",
      description:
        "Agent acknowledges the customer's situation or feelings with an empathy statement.",
      maxScore: 10,
      aiInstruction:
        "Look for phrases like \"I understand\", \"that sounds frustrating\", \"I'm sorry to hear that\".",
      order: 60,
    },
    {
      slug: "call-closure",
      category: "Closure",
      name: "Closing & next steps",
      description:
        "Agent summarises the outcome, confirms next steps, and thanks the customer.",
      maxScore: 10,
      aiInstruction:
        "Fulfilled if the agent recaps what will happen next and offers a polite close.",
      order: 70,
    },
  ];

  const parameters = await Promise.all(
    parameterSeeds.map((p) =>
      prisma.clientParameter.upsert({
        where: { id: `${client.id}-${p.slug}` },
        update: {},
        create: {
          id: `${client.id}-${p.slug}`,
          clientId: client.id,
          parameterCategory: p.category,
          parameterName: p.name,
          parameterDescription: p.description,
          maxScore: p.maxScore,
          aiInstruction: p.aiInstruction,
          displayOrder: p.order,
        },
      })
    )
  );

  const maxPossibleScore = parameters.reduce((sum, p) => sum + p.maxScore, 0);

  // --- Demo calls ----------------------------------------------------------
  type SegmentSeed = { speaker: "AGENT" | "CUSTOMER"; text: string; startMs: number; endMs: number };

  interface CallSeed {
    slug: string;
    daysAgo: number;
    direction: "INBOUND" | "OUTBOUND";
    status: "COMPLETED" | "DROPPED" | "TRANSFERRED";
    disposition: string;
    durationSec: number;
    firstResponseSec?: number;
    agent: typeof agents[number];
    campaign: typeof campaigns[number];
    callerNumber: string;
    calleeNumber: string;
    customerName?: string;
    transcript: SegmentSeed[];
    audit?: {
      summary: string;
      sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
      passedSlugs: string[]; // slugs of parameters considered fulfilled
    };
    manualReview?: {
      reviewer: string;
      status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
      notes?: string;
      scorePercent?: number;
      disposition?: "Good" | "Bad" | "Moderate";
    };
    insights?: Array<{
      type: "COACHING" | "RISK" | "COMPLIANCE" | "OPPORTUNITY" | "SENTIMENT";
      severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      title: string;
      body: string;
    }>;
    notes?: Array<{ author: string; body: string; pinned?: boolean }>;
  }

  const callSeeds: CallSeed[] = [
    {
      slug: "call-001",
      daysAgo: 1,
      direction: "OUTBOUND",
      status: "COMPLETED",
      disposition: "Sale",
      durationSec: 312,
      agent: agents[0],
      campaign: campaigns[0],
      callerNumber: "+1-555-0100",
      calleeNumber: "+1-555-0190",
      customerName: "John Mitchell",
      firstResponseSec: 5,
      transcript: [
        { speaker: "AGENT", text: "Good morning, this is Priya from Acme Bank. Am I speaking with John?", startMs: 0, endMs: 4500 },
        { speaker: "CUSTOMER", text: "Yes, this is John.", startMs: 4500, endMs: 6200 },
        { speaker: "AGENT", text: "To verify, could you confirm your date of birth and the last four digits of your card?", startMs: 6200, endMs: 12000 },
        { speaker: "CUSTOMER", text: "Sure, 12 March 1985 and the last four are 4421.", startMs: 12000, endMs: 17000 },
        { speaker: "AGENT", text: "Thanks for confirming. How have you been finding the current card you have with us?", startMs: 17000, endMs: 22000 },
        { speaker: "CUSTOMER", text: "It's fine, but the cashback is pretty limited.", startMs: 22000, endMs: 26000 },
        { speaker: "AGENT", text: "That's exactly why I'm calling. We have a new Platinum card with 3% cashback on groceries. The annual fee is $95 after the first year, and there's a 12-month minimum tenure.", startMs: 26000, endMs: 38000 },
        { speaker: "AGENT", text: "Before we proceed, I need to read a short disclosure. This call is being recorded, your rate may change based on creditworthiness, and missed payments can affect your credit score.", startMs: 38000, endMs: 50000 },
        { speaker: "CUSTOMER", text: "Okay, sounds good. Let's do it.", startMs: 50000, endMs: 53000 },
        { speaker: "AGENT", text: "Excellent. I've started the application. You'll get an email within 24 hours and the new card in about a week. Thanks for your time today, John!", startMs: 53000, endMs: 62000 },
      ],
      audit: {
        summary: "Strong, compliant sale. Agent verified identity, presented value clearly, and read required disclosures before closing.",
        sentiment: "POSITIVE",
        passedSlugs: [
          "opening-greeting",
          "identity-verification",
          "needs-discovery",
          "solution-clarity",
          "compliance-disclosures",
          "empathy",
          "call-closure",
        ],
      },
      manualReview: {
        reviewer: "QA — Sandra",
        status: "COMPLETED",
        notes: "Excellent compliance. Tone was warm. Closing was crisp.",
        scorePercent: 100,
        disposition: "Good",
      },
      insights: [
        {
          type: "COACHING",
          severity: "LOW",
          title: "Strong disclosure delivery",
          body: "Agent delivered disclosures unhurried — use this as a coaching example for the team.",
        },
      ],
      notes: [
        { author: "QA — Sandra", body: "Use as gold standard for the Platinum card script.", pinned: true },
      ],
    },
    {
      slug: "call-002",
      daysAgo: 1,
      direction: "OUTBOUND",
      status: "COMPLETED",
      disposition: "Not interested",
      durationSec: 178,
      agent: agents[1],
      campaign: campaigns[0],
      callerNumber: "+1-555-0101",
      calleeNumber: "+1-555-0191",
      customerName: "Maria Lopez",
      firstResponseSec: 4,
      transcript: [
        { speaker: "AGENT", text: "Hi, Marcus calling from Acme. Who am I talking to?", startMs: 0, endMs: 3500 },
        { speaker: "CUSTOMER", text: "This is Maria. What's this about?", startMs: 3500, endMs: 6000 },
        { speaker: "AGENT", text: "We're offering a new card with cashback rewards.", startMs: 6000, endMs: 10000 },
        { speaker: "CUSTOMER", text: "Not interested, thanks.", startMs: 10000, endMs: 12000 },
        { speaker: "AGENT", text: "Okay. Goodbye.", startMs: 12000, endMs: 13500 },
      ],
      audit: {
        summary: "Agent skipped identity verification and required disclosures. Short call, no rapport built.",
        sentiment: "NEGATIVE",
        passedSlugs: ["call-closure"],
      },
      insights: [
        {
          type: "COMPLIANCE",
          severity: "HIGH",
          title: "Missing identity verification",
          body: "Agent did not request any verifying information before pitching the product.",
        },
        {
          type: "COACHING",
          severity: "MEDIUM",
          title: "Build rapport before pitching",
          body: "An open-ended discovery question may have surfaced needs and avoided an immediate refusal.",
        },
      ],
    },
    {
      slug: "call-003",
      daysAgo: 2,
      direction: "INBOUND",
      status: "COMPLETED",
      disposition: "Retained",
      durationSec: 521,
      agent: agents[4],
      campaign: campaigns[1],
      callerNumber: "+1-555-0192",
      calleeNumber: "+1-555-0102",
      customerName: "Daniel Kumar",
      firstResponseSec: 7,
      transcript: [
        { speaker: "AGENT", text: "Thank you for calling Acme retention, this is Naomi. How can I help today?", startMs: 0, endMs: 5000 },
        { speaker: "CUSTOMER", text: "Hi Naomi, I'm thinking of cancelling my plan.", startMs: 5000, endMs: 9000 },
        { speaker: "AGENT", text: "I'm sorry to hear that. Could I grab your account number and the postcode on file so I can look into it?", startMs: 9000, endMs: 16000 },
        { speaker: "CUSTOMER", text: "Sure, account is 8821-2231 and postcode 10001.", startMs: 16000, endMs: 22000 },
        { speaker: "AGENT", text: "Thank you. What's prompting the change?", startMs: 22000, endMs: 26000 },
        { speaker: "CUSTOMER", text: "Honestly, the monthly cost feels high for what we use.", startMs: 26000, endMs: 31000 },
        { speaker: "AGENT", text: "That totally makes sense. Let me see what loyalty options I have for you. I can offer 20% off for the next 6 months on your current plan with no commitment change.", startMs: 31000, endMs: 44000 },
        { speaker: "CUSTOMER", text: "Okay, that helps. Let's do that.", startMs: 44000, endMs: 47000 },
        { speaker: "AGENT", text: "Wonderful. I'll apply it now. You'll see the discounted price on your next bill. Anything else I can help with?", startMs: 47000, endMs: 54000 },
        { speaker: "CUSTOMER", text: "No, that's it. Thanks Naomi.", startMs: 54000, endMs: 57000 },
        { speaker: "AGENT", text: "Thanks for staying with Acme. Have a great day!", startMs: 57000, endMs: 61000 },
      ],
      audit: {
        summary: "Effective retention save with empathy and a clear offer. Disclosures not applicable on this flow.",
        sentiment: "POSITIVE",
        passedSlugs: [
          "opening-greeting",
          "identity-verification",
          "needs-discovery",
          "solution-clarity",
          "empathy",
          "call-closure",
        ],
      },
      manualReview: {
        reviewer: "QA — Sandra",
        status: "IN_PROGRESS",
        disposition: "Good",
        scorePercent: 92,
      },
      insights: [
        {
          type: "OPPORTUNITY",
          severity: "LOW",
          title: "Strong empathy",
          body: "Agent's empathy statement set up a successful retention.",
        },
      ],
    },
    {
      slug: "call-004",
      daysAgo: 3,
      direction: "INBOUND",
      status: "COMPLETED",
      disposition: "Resolved",
      durationSec: 247,
      agent: agents[2],
      campaign: campaigns[2],
      callerNumber: "+1-555-0193",
      calleeNumber: "+1-555-0103",
      customerName: "Mike Ng",
      firstResponseSec: 3,
      transcript: [
        { speaker: "AGENT", text: "Acme support, Amelia speaking.", startMs: 0, endMs: 2800 },
        { speaker: "CUSTOMER", text: "Hi, my app keeps crashing when I log in.", startMs: 2800, endMs: 7000 },
        { speaker: "AGENT", text: "Sorry to hear that. Can I have your username so I can take a look?", startMs: 7000, endMs: 12000 },
        { speaker: "CUSTOMER", text: "It's mike_82.", startMs: 12000, endMs: 13500 },
        { speaker: "AGENT", text: "Thanks. I see your app version is older. Let's update it together — could you go to the app store?", startMs: 13500, endMs: 22000 },
        { speaker: "CUSTOMER", text: "Done, updating now... okay, looks better.", startMs: 22000, endMs: 28000 },
        { speaker: "AGENT", text: "Great. Anything else I can help with?", startMs: 28000, endMs: 31000 },
        { speaker: "CUSTOMER", text: "No that's all.", startMs: 31000, endMs: 32500 },
        { speaker: "AGENT", text: "Thanks for calling Acme support.", startMs: 32500, endMs: 35000 },
      ],
      audit: {
        summary: "Quick technical fix. Agent only collected username (single identifier); compliance and disclosures not applicable for this support flow.",
        sentiment: "NEUTRAL",
        passedSlugs: ["opening-greeting", "needs-discovery", "solution-clarity", "call-closure"],
      },
      notes: [{ author: "Floor lead", body: "Good first-call resolution." }],
    },
    {
      slug: "call-005",
      daysAgo: 4,
      direction: "OUTBOUND",
      status: "DROPPED",
      disposition: "Disconnect",
      durationSec: 41,
      agent: agents[3],
      campaign: campaigns[0],
      callerNumber: "+1-555-0104",
      calleeNumber: "+1-555-0194",
      customerName: "Unknown",
      firstResponseSec: 2,
      transcript: [
        { speaker: "AGENT", text: "Hello, David from Acme.", startMs: 0, endMs: 2200 },
        { speaker: "CUSTOMER", text: "Hello?", startMs: 2200, endMs: 3500 },
        { speaker: "AGENT", text: "I'm calling about a new offer—", startMs: 3500, endMs: 6500 },
        { speaker: "CUSTOMER", text: "(line drops)", startMs: 6500, endMs: 8000 },
      ],
      audit: {
        summary: "Line dropped before any meaningful interaction. Not coachable.",
        sentiment: "NEUTRAL",
        passedSlugs: [],
      },
      manualReview: { reviewer: "QA — Sandra", status: "PENDING", disposition: "Bad" },
    },
    {
      slug: "call-006",
      daysAgo: 5,
      direction: "INBOUND",
      status: "COMPLETED",
      disposition: "Escalated",
      durationSec: 612,
      agent: agents[4],
      campaign: campaigns[1],
      callerNumber: "+1-555-0195",
      calleeNumber: "+1-555-0105",
      customerName: "Jane Brown",
      firstResponseSec: 6,
      transcript: [
        { speaker: "AGENT", text: "Acme retention, Naomi speaking.", startMs: 0, endMs: 3000 },
        { speaker: "CUSTOMER", text: "I want to speak to a manager right now. I've been charged twice.", startMs: 3000, endMs: 9000 },
        { speaker: "AGENT", text: "I completely understand and I'm sorry for the trouble. Let me pull up your account — could you confirm your name and postcode?", startMs: 9000, endMs: 18000 },
        { speaker: "CUSTOMER", text: "Jane Brown, postcode 10010.", startMs: 18000, endMs: 22000 },
        { speaker: "AGENT", text: "Thank you Jane. I can see the duplicate charge. I'll refund it now and escalate the billing issue to a supervisor for review.", startMs: 22000, endMs: 33000 },
        { speaker: "CUSTOMER", text: "Thank you. I appreciate you sorting it out.", startMs: 33000, endMs: 36500 },
        { speaker: "AGENT", text: "Of course. You'll see the refund in 3-5 business days. Anything else?", startMs: 36500, endMs: 42000 },
        { speaker: "CUSTOMER", text: "No, that's everything.", startMs: 42000, endMs: 43500 },
        { speaker: "AGENT", text: "Thanks for letting us put it right. Have a good day.", startMs: 43500, endMs: 47000 },
      ],
      audit: {
        summary: "Excellent handling of an upset caller. Refund issued and supervisor escalation initiated.",
        sentiment: "POSITIVE",
        passedSlugs: [
          "opening-greeting",
          "identity-verification",
          "needs-discovery",
          "solution-clarity",
          "empathy",
          "call-closure",
        ],
      },
      insights: [
        {
          type: "RISK",
          severity: "MEDIUM",
          title: "Billing system duplicate charge",
          body: "Multiple recent calls reference duplicate billing — flag to billing engineering.",
        },
      ],
      notes: [
        { author: "Naomi", body: "Customer was upset on open but ended very satisfied. Escalation case #44219." },
      ],
    },
  ];

  for (const seed of callSeeds) {
    const externalCallId = `EXT-${seed.slug.toUpperCase()}`;
    const startedAt = daysAgo(seed.daysAgo, 10 + seed.daysAgo, 15);
    const endedAt = new Date(startedAt.getTime() + seed.durationSec * 1000);

    // Derive denormalised quality columns from the seed up-front so the call
    // table can be queried directly without joining audit/review rows.
    const passedSet = seed.audit ? new Set(seed.audit.passedSlugs) : null;
    const aiScorePercent = seed.audit
      ? (parameters.reduce(
          (sum, p) => sum + (passedSet?.has(p.id.replace(`${client.id}-`, "")) ? p.maxScore : 0),
          0,
        ) /
          maxPossibleScore) *
        100
      : null;
    const manualScorePercent = seed.manualReview?.scorePercent ?? null;
    const finalScorePercent = manualScorePercent ?? aiScorePercent;
    const sentimentText =
      seed.audit?.sentiment ?? null;

    const baseCallData = {
      campaignId: seed.campaign.id,
      agentId: seed.agent.id,
      teamId: seed.agent.teamId,
      callerNumber: seed.callerNumber,
      calleeNumber: seed.calleeNumber,
      customerName: seed.customerName ?? null,
      direction: seed.direction,
      callStartedAt: startedAt,
      callEndedAt: endedAt,
      durationSeconds: seed.durationSec,
      firstResponseSeconds: seed.firstResponseSec ?? null,
      averageHandleSeconds: seed.durationSec,
      recordingUrl: `https://recordings.example/${externalCallId}.mp3`,
      language: "en-US",
      status: seed.status,
      disposition: seed.disposition,
      sentiment: sentimentText,
      aiScore: aiScorePercent,
      manualScore: manualScorePercent,
      finalScore: finalScorePercent,
      manualDisposition: seed.manualReview?.disposition ?? null,
    };

    const call = await prisma.call.upsert({
      where: {
        clientId_externalCallId: { clientId: client.id, externalCallId },
      },
      update: baseCallData,
      create: {
        clientId: client.id,
        externalCallId,
        ...baseCallData,
      },
    });

    // Transcript + segments
    await prisma.callTranscript.deleteMany({ where: { callId: call.id } });
    const transcript = await prisma.callTranscript.create({
      data: {
        callId: call.id,
        source: "AI",
        language: "en-US",
        modelUsed: "demo-transcribe-v1",
        fullText: seed.transcript.map((s) => `${s.speaker}: ${s.text}`).join("\n"),
        generatedAt: new Date(endedAt.getTime() + 30_000),
        segments: {
          create: seed.transcript.map((s, idx) => ({
            sequence: idx,
            speaker: s.speaker,
            startMs: s.startMs,
            endMs: s.endMs,
            text: s.text,
          })),
        },
      },
    });

    // Audit + parameter scores
    if (seed.audit) {
      await prisma.aiAudit.deleteMany({ where: { callId: call.id } });
      const auditPassed = new Set(seed.audit.passedSlugs);
      const scoreData: Prisma.AiParameterScoreCreateWithoutAiAuditInput[] = parameters.map((p) => {
        const slug = p.id.replace(`${client.id}-`, "");
        const passed = auditPassed.has(slug);
        return {
          parameter: { connect: { id: p.id } },
          score: passed ? p.maxScore : 0,
          maxScore: p.maxScore,
          isPassed: passed,
          reasoning: passed
            ? `Evidence in transcript supports "${p.parameterName}".`
            : `No clear evidence of "${p.parameterName}" in transcript.`,
        };
      });
      const overall = scoreData.reduce((sum, s) => sum + (s.score as number), 0);
      const scorePercent = (overall / maxPossibleScore) * 100;

      await prisma.aiAudit.create({
        data: {
          callId: call.id,
          status: "COMPLETED",
          modelUsed: "demo-audit-v1",
          promptVersion: "v0.1",
          overallScore: overall,
          maxPossibleScore,
          scorePercent,
          summary: seed.audit.summary,
          sentiment: seed.audit.sentiment,
          startedAt: new Date(endedAt.getTime() + 60_000),
          completedAt: new Date(endedAt.getTime() + 120_000),
          parameterScores: { create: scoreData },
        },
      });
    }

    // Insights
    if (seed.insights?.length) {
      await prisma.aiInsight.deleteMany({ where: { callId: call.id } });
      await prisma.aiInsight.createMany({
        data: seed.insights.map((i) => ({
          callId: call.id,
          insightType: i.type,
          severity: i.severity,
          title: i.title,
          body: i.body,
        })),
      });
    }

    // Manual review
    if (seed.manualReview) {
      await prisma.manualReview.deleteMany({ where: { callId: call.id } });
      await prisma.manualReview.create({
        data: {
          callId: call.id,
          reviewerName: seed.manualReview.reviewer,
          status: seed.manualReview.status,
          notes: seed.manualReview.notes,
          scorePercent: seed.manualReview.scorePercent,
          maxScore: seed.manualReview.scorePercent != null ? 100 : null,
          score: seed.manualReview.scorePercent,
          startedAt: seed.manualReview.status !== "PENDING" ? new Date(endedAt.getTime() + 3600_000) : null,
          completedAt: seed.manualReview.status === "COMPLETED" ? new Date(endedAt.getTime() + 7200_000) : null,
        },
      });
    }

    // Notes
    if (seed.notes?.length) {
      await prisma.callNote.deleteMany({ where: { callId: call.id } });
      await prisma.callNote.createMany({
        data: seed.notes.map((n) => ({
          callId: call.id,
          authorName: n.author,
          body: n.body,
          isPinned: n.pinned ?? false,
        })),
      });
    }

    // Events timeline
    await prisma.callEvent.deleteMany({ where: { callId: call.id } });
    const events: Array<{ type: Prisma.CallEventCreateManyInput["eventType"]; when: Date }> = [
      { type: "CALL_IMPORTED", when: startedAt },
      { type: "TRANSCRIPT_READY", when: new Date(endedAt.getTime() + 30_000) },
    ];
    if (seed.audit) {
      events.push({ type: "AUDIT_QUEUED", when: new Date(endedAt.getTime() + 45_000) });
      events.push({ type: "AUDIT_STARTED", when: new Date(endedAt.getTime() + 60_000) });
      events.push({ type: "AUDIT_COMPLETED", when: new Date(endedAt.getTime() + 120_000) });
    }
    if (seed.manualReview && seed.manualReview.status !== "PENDING") {
      events.push({ type: "MANUAL_REVIEW_STARTED", when: new Date(endedAt.getTime() + 3600_000) });
      if (seed.manualReview.status === "COMPLETED") {
        events.push({
          type: "MANUAL_REVIEW_COMPLETED",
          when: new Date(endedAt.getTime() + 7200_000),
        });
      }
    }
    await prisma.callEvent.createMany({
      data: events.map((e) => ({
        callId: call.id,
        eventType: e.type,
        occurredAt: e.when,
      })),
    });

    // Touch the transcript so the linter doesn't warn about the unused variable.
    void transcript;
  }

  console.log("Seed complete.");
  console.log(`  Client:     ${client.name} (${client.slug})`);
  console.log(`  Password:   ${password}`);
  console.log(`  Campaigns:  ${campaigns.length}`);
  console.log(`  Teams:      ${teams.length}`);
  console.log(`  Agents:     ${agents.length}`);
  console.log(`  Parameters: ${parameters.length}`);
  console.log(`  Calls:      ${callSeeds.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
