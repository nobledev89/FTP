import {
  auditOutputSchema,
  type AuditOutput,
  type DraftOutput,
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
import { Deterministic } from "./deterministic.js";
import { parseDirectives, verdictForCycle } from "./directives.js";
import { MockStageError, mockNote, runDirectives } from "./shared.js";

/**
 * Deterministic editorial audit for the mock pipeline.
 *
 * The verdict is chosen by the job's `mock:audit` directive rather than by chance, because the
 * point of the mock audit is to drive a chosen branch: PASS goes straight to approval,
 * REVISION_REQUIRED exercises the revision cycle and its gates, and NEEDS_HUMAN exercises
 * escalation. The findings themselves are real findings about the mock draft.
 */

export type AuditStageInput = Readonly<{
  packet: ResearchPacketOutput;
  draft: DraftOutput;
  draftVersion: number;
}>;

type Finding = AuditOutput["findings"][number];

const REVISION_FINDINGS: readonly Finding[] = [
  {
    severity: "major",
    category: "support",
    location: "Section: what is still open",
    problem: "The indicative compliance cost is presented without saying that it is unsourced.",
    reason:
      "The research packet records this figure as unverified with no official impact assessment " +
      "behind it. A reader would take it as a published estimate.",
    recommendedCorrection:
      "State in the same sentence that the figure is indicative and that no official impact " +
      "assessment was located.",
  },
  {
    severity: "major",
    category: "jurisdiction",
    location: "Opening paragraph",
    problem: "The opening does not say which jurisdiction the article is about.",
    reason:
      "The style guide requires the UK position to be explicit so a non-UK rule is never read as " +
      "a UK rule.",
    recommendedCorrection:
      "Name the United Kingdom, and the lead regulator, in the first two sentences.",
  },
  {
    severity: "minor",
    category: "structure",
    location: "Closing section",
    problem: "The article ends on a standing note rather than on what to watch next.",
    reason:
      "The style guide asks articles to close with what happens next or where the detail lives.",
    recommendedCorrection: "Move the official-sources section after the open questions.",
  },
];

const ESCALATION_FINDINGS: readonly Finding[] = [
  {
    severity: "critical",
    category: "contradiction",
    location: "Section: what is still open",
    problem:
      "Two primary sources give different implementation dates and neither is clearly superseded.",
    reason:
      "Choosing one date would assert something the evidence does not support; reporting both " +
      "without an editor's judgement leaves the reader unable to act.",
    recommendedCorrection:
      "An editor should decide how to present the conflict, or commission further research.",
  },
];

const PASS_FINDINGS: readonly Finding[] = [
  {
    severity: "minor",
    category: "seo",
    location: "Meta description",
    problem: "The meta description is close to the excerpt.",
    reason: "A distinct description performs better in search results.",
    recommendedCorrection: "Rewrite the meta description to lead with the concrete change.",
  },
];

export class MockAuditAdapter implements StageAdapter<AuditStageInput, AuditOutput> {
  readonly stage = "audit" as const;
  readonly mode = "mock" as const;
  readonly provider = "openai" as const;

  async prepare(input: AuditStageInput, context: RunContext): Promise<PreparedRun> {
    const { brief } = context;
    const prompt = context.template
      ? renderTemplate(context.template.content, {
          styleGuide: context.styleGuide ?? "",
          topic: brief.topic,
          articleType: brief.articleType,
          cycle: String(context.cycle),
          today: brief.today,
          researchPacket: JSON.stringify(input.packet, null, 2),
          draft: JSON.stringify(input.draft, null, 2),
          schemaVersion: context.schemaVersion,
        })
      : `Audit the draft for: ${brief.topic}`;

    return {
      prompt,
      promptTemplateId: context.template?.id ?? null,
      promptVersion: context.template?.version ?? null,
      inputRefs: {
        draft_version: input.draftVersion,
        body_length: input.draft.bodyMarkdown.length,
        sources: input.packet.sources.length,
      },
      schemaVersion: context.schemaVersion,
      provider: this.provider,
      mode: this.mode,
      idempotencyKey: idempotencyKeyFor(this.stage, context),
    };
  }

  async execute(request: ExecuteRequest<AuditStageInput>): Promise<RawRunResult> {
    const directed = await runDirectives(this.stage, request);
    if (directed) return directed;
    return {
      kind: "output",
      value: buildAudit(request.context, request.input),
      usage: { simulated: true },
    };
  }

  async normalize(raw: RawRunResult, context: RunContext): Promise<AuditOutput> {
    void context;
    if (raw.kind !== "output") {
      throw new MockStageError("the audit stage produced no output", "invalid_output");
    }
    return auditOutputSchema.parse(raw.value);
  }
}

/** Builds the audit. Exported so the deterministic output can be asserted without a database. */
export function buildAudit(context: RunContext, input: AuditStageInput): AuditOutput {
  const directives = parseDirectives(context.brief.keywords);
  const verdict = verdictForCycle(directives, context.cycle);
  const random = new Deterministic(context.brief.jobId, "audit", context.cycle);

  const findings =
    verdict === "PASS"
      ? random.sample(PASS_FINDINGS, random.integer(0, PASS_FINDINGS.length))
      : verdict === "NEEDS_HUMAN"
        ? ESCALATION_FINDINGS
        : REVISION_FINDINGS;

  const summary =
    verdict === "PASS"
      ? `Draft v${input.draftVersion} is publishable. Sourcing, jurisdiction, and risk context are ` +
        `present, and no claim goes beyond the research packet. ${mockNote()}`
      : verdict === "NEEDS_HUMAN"
        ? `Draft v${input.draftVersion} cannot be resolved from the existing packet: the primary ` +
          `sources conflict on a material date. An editor has to decide. ${mockNote()}`
        : `Draft v${input.draftVersion} needs revision: ${findings.length} findings, ` +
          `${findings.filter((finding) => finding.severity !== "minor").length} of them material. ` +
          mockNote();

  return auditOutputSchema.parse({ verdict, summary, findings: [...findings] });
}
