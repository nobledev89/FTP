import {
  ARTIFACT_SCHEMA_VERSIONS,
  researchPacketOutputSchema,
  type ResearchPacketOutput,
} from "../../contracts/artifacts.js";
import {
  idempotencyKeyFor,
  renderTemplate,
  type ExecuteRequest,
  type PreparedRun,
  type RawRunResult,
  type RunContext,
  type StageAdapter,
} from "../contract.js";
import { Deterministic, slugToken } from "./deterministic.js";
import { MockStageError, mockNote, runDirectives } from "./shared.js";

/**
 * Deterministic research for the mock pipeline.
 *
 * The packet is shaped exactly like a real one — UK primary sources, keyed claims with evidence,
 * contradictions, uncertainties, and a recommended structure — so the drafting stage, the admin
 * console, and the publication source list all exercise their real code paths. Its sources are the
 * publishers' own landing pages rather than invented deep links, so nothing in the database claims
 * a specific document exists.
 */

type SourceSeed = Readonly<{
  key: string;
  url: string;
  title: string;
  publisher: string;
  sourceType: ResearchPacketOutput["sources"][number]["sourceType"];
  quality: ResearchPacketOutput["sources"][number]["quality"];
}>;

const UK_SOURCES: readonly SourceSeed[] = [
  {
    key: "fca-publications",
    url: "https://www.fca.org.uk/publications",
    title: "Financial Conduct Authority publications",
    publisher: "Financial Conduct Authority",
    sourceType: "regulator",
    quality: "primary",
  },
  {
    key: "boe-news",
    url: "https://www.bankofengland.co.uk/news",
    title: "Bank of England news and publications",
    publisher: "Bank of England",
    sourceType: "central_bank",
    quality: "primary",
  },
  {
    key: "hmt-publications",
    url: "https://www.gov.uk/government/organisations/hm-treasury",
    title: "HM Treasury",
    publisher: "HM Treasury",
    sourceType: "government",
    quality: "primary",
  },
  {
    key: "psr-publications",
    url: "https://www.psr.org.uk/publications/",
    title: "Payment Systems Regulator publications",
    publisher: "Payment Systems Regulator",
    sourceType: "regulator",
    quality: "primary",
  },
  {
    key: "legislation-uk",
    url: "https://www.legislation.gov.uk/",
    title: "legislation.gov.uk",
    publisher: "The National Archives",
    sourceType: "legislation",
    quality: "primary",
  },
  {
    key: "ons-economy",
    url: "https://www.ons.gov.uk/economy",
    title: "Office for National Statistics: economy",
    publisher: "Office for National Statistics",
    sourceType: "statistics",
    quality: "primary",
  },
  {
    key: "companies-house",
    url: "https://find-and-update.company-information.service.gov.uk/",
    title: "Companies House register",
    publisher: "Companies House",
    sourceType: "company_filing",
    quality: "primary",
  },
  {
    key: "cma-cases",
    url: "https://www.gov.uk/cma-cases",
    title: "Competition and Markets Authority cases",
    publisher: "Competition and Markets Authority",
    sourceType: "regulator",
    quality: "primary",
  },
];

const MOCK_EXCERPT =
  "Simulated evidence produced by the mock research provider. It stands in for a real citation " +
  "while the pipeline is exercised and asserts nothing about this publisher's actual output.";

const STRUCTURES: readonly (readonly string[])[] = [
  [
    "What changed",
    "Who it affects in the UK",
    "What the rules actually say",
    "What firms have to do next",
    "What to watch",
  ],
  [
    "The headline",
    "Background",
    "How the mechanism works",
    "Costs, limits, and risks",
    "Open questions",
  ],
  [
    "In brief",
    "Why this is happening now",
    "The UK position",
    "How it compares elsewhere",
    "What happens next",
  ],
];

export type ResearchStageInput = Readonly<{ notes?: string | null }>;

export class MockResearchAdapter implements StageAdapter<ResearchStageInput, ResearchPacketOutput> {
  readonly stage = "research" as const;
  readonly mode = "mock" as const;
  readonly provider = "openai" as const;

  async prepare(_input: ResearchStageInput, context: RunContext): Promise<PreparedRun> {
    const { brief } = context;
    const prompt = context.template
      ? renderTemplate(context.template.content, {
          styleGuide: context.styleGuide ?? "",
          topic: brief.topic,
          articleType: brief.articleType,
          category: brief.category ?? "unset",
          keywords: brief.keywords.join(", "),
          targetWordCount: String(brief.targetWordCount ?? "unset"),
          requirements: brief.requirements ?? "none",
          today: brief.today,
          schemaVersion: context.schemaVersion,
        })
      : `Research the UK fintech topic: ${brief.topic}`;

    return {
      prompt,
      promptTemplateId: context.template?.id ?? null,
      promptVersion: context.template?.version ?? null,
      inputRefs: {
        topic_length: brief.topic.length,
        keywords: brief.keywords.length,
        article_type: brief.articleType,
      },
      schemaVersion: context.schemaVersion,
      provider: this.provider,
      mode: this.mode,
      idempotencyKey: idempotencyKeyFor(this.stage, context),
    };
  }

  async execute(request: ExecuteRequest<ResearchStageInput>): Promise<RawRunResult> {
    const directed = await runDirectives(this.stage, request);
    if (directed) return directed;
    return {
      kind: "output",
      value: buildResearchPacket(request.context),
      usage: { simulated: true },
    };
  }

  async normalize(raw: RawRunResult, context: RunContext): Promise<ResearchPacketOutput> {
    void context;
    if (raw.kind !== "output") {
      throw new MockStageError("the research stage produced no output", "invalid_output");
    }
    return researchPacketOutputSchema.parse(raw.value);
  }
}

/** Builds the packet. Exported so the deterministic output can be asserted without a database. */
export function buildResearchPacket(context: RunContext): ResearchPacketOutput {
  const { brief } = context;
  const random = new Deterministic(brief.jobId, "research", context.cycle);
  const token = slugToken(brief.topic);
  const subject = brief.topic.trim();
  const accessedAt = new Date(`${brief.today}T09:00:00Z`).toISOString();

  const sources = random.sample(UK_SOURCES, random.integer(4, 6)).map((seed) => ({
    sourceKey: seed.key,
    url: seed.url,
    title: seed.title,
    publisher: seed.publisher,
    publishedOn: brief.today,
    sourceType: seed.sourceType,
    quality: seed.quality,
    jurisdiction: "GB",
    accessedAt,
    excerpt: MOCK_EXCERPT,
    isPrivate: false,
  }));

  const primaryKeys = sources.map((source) => source.sourceKey);
  const firstKey = primaryKeys[0] as string;
  const secondKey = primaryKeys[1] ?? firstKey;
  const thirdKey = primaryKeys[2] ?? secondKey;

  const claims = [
    {
      claimKey: `${token}-scope`,
      text: `${subject} falls within the remit of a UK financial regulator, so firms in scope have reporting obligations.`,
      status: "supported" as const,
      confidence: 0.82,
      jurisdiction: "GB",
      effectiveDate: brief.today,
      asOfDate: brief.today,
      entities: ["Financial Conduct Authority"],
      notes: null,
      evidence: [
        { sourceKey: firstKey, relation: "supports" as const, locator: "Publications index" },
      ],
    },
    {
      claimKey: `${token}-timing`,
      text: `Implementation dates for ${subject} are staged rather than simultaneous, which matters for smaller firms.`,
      status: "mixed" as const,
      confidence: 0.55,
      jurisdiction: "GB",
      effectiveDate: null,
      asOfDate: brief.today,
      entities: ["HM Treasury"],
      notes: "Sources disagree on the final date for smaller firms.",
      evidence: [
        { sourceKey: secondKey, relation: "supports" as const, locator: "Timetable" },
        { sourceKey: thirdKey, relation: "contradicts" as const, locator: "Consultation response" },
      ],
    },
    {
      claimKey: `${token}-cost`,
      text: `Estimated one-off compliance cost for a mid-sized UK firm is in the low hundreds of thousands of pounds.`,
      status: "unverified" as const,
      confidence: 0.35,
      jurisdiction: "GB",
      effectiveDate: null,
      asOfDate: brief.today,
      entities: [],
      notes: "No official impact assessment figure located; treat as indicative only.",
      evidence: [{ sourceKey: thirdKey, relation: "context" as const, locator: null }],
    },
  ];

  const packet = {
    topicInterpretation:
      `Read as a UK-market question about ${subject}, aimed at a reader who works in or near ` +
      `financial services and needs to know what applies to them and when.`,
    angle: `What ${subject} changes in practice for UK firms and consumers, and what is still open.`,
    facts: [
      `${subject} is being handled under the UK's own rulebook rather than an inherited EU regime.`,
      "The lead regulator has published its expectations through its normal consultation process.",
      "Smaller firms have a longer transition window than the largest institutions.",
      "No enforcement action has been announced at the time of writing.",
    ],
    claims,
    statistics: [
      "Indicative one-off compliance cost: £150,000 to £400,000 for a mid-sized firm (as of " +
        `${brief.today}, mock figure).`,
      "Transition window: 12 months for the largest firms, 24 months for the rest.",
    ],
    dates: [
      `${brief.today}: research packet assembled.`,
      "Staged implementation begins the following quarter.",
    ],
    entities: [
      "Financial Conduct Authority",
      "Bank of England",
      "HM Treasury",
      "Payment Systems Regulator",
    ],
    sources,
    contradictions: [
      "The consultation timetable and the published policy statement give different end dates for " +
        "smaller firms; the article should report both rather than choose.",
    ],
    uncertainties: [
      "Whether the transition window will be extended has not been confirmed.",
      "No official impact assessment figure was located for the compliance cost.",
    ],
    questions: [
      `Does ${subject} apply to firms below the small-firm threshold?`,
      "What has to be in place on day one, and what can follow?",
      "Who at a firm is accountable if it is not?",
      "What does a consumer actually notice?",
    ],
    recommendedStructure: [...random.pick(STRUCTURES)],
  };

  return researchPacketOutputSchema.parse(packet);
}

/** A one-line summary stored alongside the packet, shown in the console's research panel. */
export function researchSummary(packet: ResearchPacketOutput): string {
  return (
    `${packet.sources.length} sources, ${packet.claims.length} claims, ` +
    `${packet.contradictions.length} contradictions, ${packet.uncertainties.length} uncertainties. ` +
    mockNote()
  );
}

export { ARTIFACT_SCHEMA_VERSIONS };
