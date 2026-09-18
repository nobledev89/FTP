import { ARTIFACT_SCHEMA_VERSIONS, type DraftOutput } from "../contracts/artifacts.js";
import type { ArtifactStore, JobContext } from "../db/artifact-store.js";
import type { Json } from "../db/database.types.js";
import { StructuredLogger } from "../logging/logger.js";
import type { PipelineStage, PromptTemplate, RunContext } from "../providers/contract.js";
import { resolveAdapter } from "../providers/registry.js";
import type { AuditStageInput } from "../providers/mock/audit.js";
import type { DraftStageInput } from "../providers/mock/draft.js";
import type { ImageStageInput } from "../providers/mock/images.js";
import type { ResearchStageInput } from "../providers/mock/research.js";
import { researchSummary } from "../providers/mock/research.js";
import type { PublishingService } from "../publishing/publish.js";
import { WorkerStageError } from "../queue/retry.js";
import type { StageContext, StageHandlers } from "../queue/runner.js";
import type { VerificationService } from "../verification/verify.js";

/**
 * Stage services: the only code that turns a provider result into a database row.
 *
 * Each handler follows the same shape — resolve the adapter for the job's snapshotted mode, open a
 * provider run, execute, validate, persist, close the run, then ask the state machine to move the
 * job. A failure anywhere leaves the run recorded as failed and rethrows, so the queue's existing
 * classification, backoff, and escalation handle it rather than a second copy of that logic here.
 */

export type PipelineDependencies = Readonly<{
  store: ArtifactStore;
  publisher: PublishingService;
  verifier: VerificationService;
  logger?: StructuredLogger;
  now?: () => Date;
}>;

const TEMPLATE_KEYS: Readonly<Record<PipelineStage, string | null>> = {
  research: "research",
  draft: "draft",
  revision: "revise",
  images: "image-brief",
  audit: "audit",
  publish: null,
  verify: null,
};

const SCHEMA_FOR_STAGE: Readonly<Record<string, string>> = {
  research: ARTIFACT_SCHEMA_VERSIONS.research,
  draft: ARTIFACT_SCHEMA_VERSIONS.draft,
  revision: ARTIFACT_SCHEMA_VERSIONS.draft,
  images: ARTIFACT_SCHEMA_VERSIONS.image,
  audit: ARTIFACT_SCHEMA_VERSIONS.audit,
};

function runContextFor(stage: PipelineStage, job: JobContext, context: StageContext): RunContext {
  const templateKey = TEMPLATE_KEYS[stage];
  const template: PromptTemplate | null =
    templateKey === null ? null : (job.templates.get(templateKey) ?? null);
  return {
    stage,
    mode: context.claim.mode,
    cycle: context.claim.revisionCount,
    attempt: context.claim.attempt,
    claimVersion: context.claim.lockVersion,
    brief: job.brief,
    template,
    styleGuide: job.styleGuide,
    schemaVersion: SCHEMA_FOR_STAGE[stage] ?? "internal-1",
  };
}

function failureSummary(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * A draft must brief every image slot the job requested; the image stage prompts from these briefs
 * and cannot complete a slot that has none. The manual import boundary applies the same rule.
 */
function assertImageBriefsCover(draft: DraftOutput, imageCount: number): void {
  const briefed = new Set(draft.imageBriefs.map((brief) => brief.slot));
  const missing = Array.from({ length: imageCount }, (_, slot) => slot).filter(
    (slot) => !briefed.has(slot),
  );
  if (missing.length > 0) {
    throw new WorkerStageError(
      `the draft has no image brief for requested slot ${missing.join(", ")}`,
      "invalid_output",
    );
  }
}

function isRetryable(error: unknown): boolean {
  const errorClass = (error as { errorClass?: string } | null)?.errorClass;
  return errorClass !== "permanent_config" && errorClass !== "invalid_output";
}

export function createPipelineHandlers(dependencies: PipelineDependencies): StageHandlers {
  const { store, publisher, verifier } = dependencies;
  const logger = dependencies.logger ?? new StructuredLogger();
  const now = dependencies.now ?? (() => new Date());

  /**
   * Opens a provider run, executes the adapter, and closes the run.
   *
   * `persist` runs while the provider run is still open so that an artifact write failure is
   * recorded against the run that produced it. Returning null from `persist` is not permitted: a
   * stage either settles the job or throws.
   */
  async function withProviderRun<TInput, TOutput>(
    stage: Exclude<PipelineStage, "publish" | "verify">,
    context: StageContext,
    job: JobContext,
    input: TInput,
    persist: (
      output: TOutput,
      runId: string,
    ) => Promise<Readonly<{ outputRef: Record<string, Json>; settle: () => Promise<void> }>>,
  ): Promise<void> {
    const runContext = runContextFor(stage, job, context);
    // The mode was snapshotted onto the job at creation, so a settings change mid-flight never
    // moves a running job onto a different provider.
    const adapter = resolveAdapter(
      stage as "research" | "draft" | "revision" | "images" | "audit",
      runContext.mode,
    ) as unknown as {
      prepare(
        input: TInput,
        context: RunContext,
      ): Promise<import("../providers/contract.js").PreparedRun>;
      execute(request: {
        prepared: import("../providers/contract.js").PreparedRun;
        input: TInput;
        context: RunContext;
        signal: AbortSignal;
      }): Promise<import("../providers/contract.js").RawRunResult>;
      normalize(
        raw: import("../providers/contract.js").RawRunResult,
        context: RunContext,
      ): Promise<TOutput>;
    };

    const prepared = await adapter.prepare(input, runContext);
    const run = await store.beginRun(prepared, {
      jobId: context.claim.jobId,
      stage,
      cycle: runContext.cycle,
      attempt: runContext.attempt,
      workerId: context.workerId,
    });
    context.noteProviderRun(run.id);

    try {
      const raw = await adapter.execute({
        prepared,
        input,
        context: runContext,
        signal: context.signal,
      });

      if (raw.kind === "manual_action") {
        await store.awaitManualAction(run.id);
        await context.requestManualAction(run.id, raw.message);
        logger.info("stage.manual_action", { job_id: context.claim.jobId, stage });
        return;
      }

      const output = await adapter.normalize(raw, runContext);
      const persisted = await persist(output, run.id);
      await store.succeedRun(run.id, {
        outputRef: persisted.outputRef,
        ...(raw.usage ? { usage: raw.usage } : {}),
        ...(raw.cost ? { cost: raw.cost } : {}),
      });
      await persisted.settle();
    } catch (error) {
      await store
        .failRun(run.id, {
          errorClass: ((error as { errorClass?: string }).errorClass ?? "unknown") as "unknown",
          summary: failureSummary(error),
          retryable: isRetryable(error),
        })
        .catch((secondary: unknown) => {
          logger.warn("stage.run_not_closed", {
            job_id: context.claim.jobId,
            stage,
            error: secondary,
          });
        });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------

  async function research(context: StageContext): Promise<void> {
    const job = await store.loadJobContext(context.claim.jobId, now());
    const input: ResearchStageInput = {};

    await withProviderRun<
      ResearchStageInput,
      import("../contracts/artifacts.js").ResearchPacketOutput
    >("research", context, job, input, async (packet, runId) => {
      const saved = await store.saveResearch({
        jobId: context.claim.jobId,
        runId,
        packet,
        summary: researchSummary(packet),
        template: job.templates.get("research") ?? null,
      });
      return {
        outputRef: { research_packet_id: saved.id, version: saved.version },
        settle: () =>
          context.complete("RESEARCH_COMPLETE", {
            note: `Research packet v${saved.version}`,
            metadata: {
              research_packet_id: saved.id,
              version: saved.version,
              sources: packet.sources.length,
              claims: packet.claims.length,
            },
          }),
      };
    });
  }

  async function draft(context: StageContext): Promise<void> {
    const job = await store.loadJobContext(context.claim.jobId, now());
    const research = await store.latestResearch(context.claim.jobId);
    if (!research) {
      throw new WorkerStageError(
        "the drafting stage needs a valid research packet",
        "permanent_config",
      );
    }
    const sourceIdsByKey = await store.sourceIdsFor(research.id);
    const input: DraftStageInput = { packet: research.packet, previous: undefined };

    await withProviderRun<DraftStageInput, import("../contracts/artifacts.js").DraftOutput>(
      "draft",
      context,
      job,
      input,
      async (output, runId) => {
        assertImageBriefsCover(output, job.brief.imageCount);
        const saved = await store.saveDraft({
          jobId: context.claim.jobId,
          runId,
          draft: output,
          researchPacketId: research.id,
          parentDraftId: null,
          respondsToAuditId: null,
          sourceIdsByKey,
          template: job.templates.get("draft") ?? null,
        });
        return {
          outputRef: { draft_id: saved.id, version: saved.version },
          settle: () =>
            context.complete("DRAFT_COMPLETE", {
              note: `Draft v${saved.version}: ${output.title}`,
              metadata: {
                draft_id: saved.id,
                version: saved.version,
                slug: output.slug,
                image_briefs: output.imageBriefs.length,
              },
            }),
        };
      },
    );
  }

  async function revision(context: StageContext): Promise<void> {
    const job = await store.loadJobContext(context.claim.jobId, now());
    const research = await store.latestResearch(context.claim.jobId);
    const previousDraft = await store.latestDraft(context.claim.jobId);
    const audit = await store.latestAudit(context.claim.jobId);
    if (!research || !previousDraft || !audit) {
      throw new WorkerStageError(
        "the revision stage needs a research packet, a draft, and an audit",
        "permanent_config",
      );
    }

    const input: DraftStageInput = {
      packet: research.packet,
      previous: { draft: previousDraft.draft, audit: audit.audit },
    };
    const sourceIdsByKey = await store.sourceIdsFor(research.id);

    await withProviderRun<DraftStageInput, import("../contracts/artifacts.js").DraftOutput>(
      "revision",
      context,
      job,
      input,
      async (output, runId) => {
        assertImageBriefsCover(output, job.brief.imageCount);
        const saved = await store.saveDraft({
          jobId: context.claim.jobId,
          runId,
          draft: output,
          researchPacketId: research.id,
          parentDraftId: previousDraft.id,
          // The gate for RE_AUDIT_PENDING requires the new draft to answer the latest audit.
          respondsToAuditId: audit.id,
          sourceIdsByKey,
          template: job.templates.get("revise") ?? null,
        });
        return {
          outputRef: { draft_id: saved.id, version: saved.version },
          settle: () =>
            context.complete("RE_AUDIT_PENDING", {
              note: `Revised draft v${saved.version} answering audit v${audit.version}`,
              metadata: {
                draft_id: saved.id,
                version: saved.version,
                responds_to_audit_id: audit.id,
                findings_addressed: audit.audit.findings.length,
              },
            }),
        };
      },
    );
  }

  async function images(context: StageContext): Promise<void> {
    const job = await store.loadJobContext(context.claim.jobId, now());
    const currentDraft = await store.latestDraft(context.claim.jobId);
    if (!currentDraft) {
      throw new WorkerStageError("the images stage needs a valid draft", "permanent_config");
    }

    const input: ImageStageInput = {
      draft: currentDraft.draft,
      draftVersion: currentDraft.version,
    };

    await withProviderRun<ImageStageInput, import("../providers/mock/images.js").ImageStageOutput>(
      "images",
      context,
      job,
      input,
      async (output, runId) => {
        const filesBySlot = new Map(output.files.map((file) => [file.slot, file]));
        const stored: { slot: number; id: string; version: number }[] = [];

        for (const artifact of output.artifacts) {
          const file = filesBySlot.get(artifact.slot);
          if (!file) {
            throw new WorkerStageError(
              `the images stage returned no file for slot ${artifact.slot}`,
              "invalid_output",
            );
          }
          const saved = await store.saveImage({
            jobId: context.claim.jobId,
            runId,
            artifact,
            file,
          });
          stored.push({ slot: artifact.slot, id: saved.id, version: saved.version });
        }

        return {
          outputRef: { images: stored.length, slots: stored.map((image) => image.slot) },
          settle: () =>
            context.complete("AUDIT_PENDING", {
              note: `${stored.length} images ready`,
              metadata: { images: stored as unknown as Json },
            }),
        };
      },
    );
  }

  async function audit(context: StageContext): Promise<void> {
    const job = await store.loadJobContext(context.claim.jobId, now());
    const research = await store.latestResearch(context.claim.jobId);
    const currentDraft = await store.latestDraft(context.claim.jobId);
    if (!research || !currentDraft) {
      throw new WorkerStageError(
        "the audit stage needs a research packet and a draft",
        "permanent_config",
      );
    }

    const input: AuditStageInput = {
      packet: research.packet,
      draft: currentDraft.draft,
      draftVersion: currentDraft.version,
    };

    await withProviderRun<AuditStageInput, import("../contracts/artifacts.js").AuditOutput>(
      "audit",
      context,
      job,
      input,
      async (output, runId) => {
        const saved = await store.saveAudit({
          jobId: context.claim.jobId,
          runId,
          audit: output,
          draftId: currentDraft.id,
          cycle: context.claim.revisionCount,
          template: job.templates.get("audit") ?? null,
        });

        // The database refuses a third automatic revision. Escalating here keeps the reason in the
        // job's own history rather than surfacing a constraint violation as a stage failure.
        const exhausted =
          output.verdict === "REVISION_REQUIRED" && context.claim.revisionCount >= 2;
        const toStatus = exhausted
          ? "NEEDS_HUMAN"
          : output.verdict === "PASS"
            ? "APPROVED"
            : output.verdict === "REVISION_REQUIRED"
              ? "REVISION_REQUIRED"
              : "NEEDS_HUMAN";

        const note = exhausted
          ? `Audit v${saved.version} still requires revision after ${context.claim.revisionCount} cycles; an editor has to decide.`
          : output.verdict === "NEEDS_HUMAN"
            ? `Audit v${saved.version} escalated: ${output.summary.slice(0, 500)}`
            : `Audit v${saved.version}: ${output.verdict}`;

        return {
          outputRef: { audit_id: saved.id, version: saved.version, verdict: output.verdict },
          settle: () =>
            context.complete(toStatus, {
              note,
              metadata: {
                audit_id: saved.id,
                version: saved.version,
                verdict: output.verdict,
                findings: output.findings.length,
                cycle: context.claim.revisionCount,
                ...(exhausted ? { revision_cycles_exhausted: true } : {}),
              },
            }),
        };
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Internal stages. These have no provider adapter: they are the publication boundary.
  // ---------------------------------------------------------------------------

  async function publish(context: StageContext): Promise<void> {
    const currentDraft = await store.latestDraft(context.claim.jobId);
    if (!currentDraft) {
      throw new WorkerStageError("publication needs an approved draft", "permanent_config");
    }

    const result = await context.settleDirectly(() =>
      publisher.publish({
        jobId: context.claim.jobId,
        workerId: context.workerId,
        leaseToken: context.claim.leaseToken,
        slug: currentDraft.draft.slug,
      }),
    );

    logger.info("stage.published", {
      job_id: context.claim.jobId,
      article_id: result.articleId,
      slug: result.slug,
      images: result.imagesPublished,
      cache_revalidated: result.cacheRevalidated,
    });
  }

  async function verify(context: StageContext): Promise<void> {
    const job = await store.articleIdFor(context.claim.jobId);
    if (!job) {
      throw new WorkerStageError("verification needs a published article", "permanent_config");
    }

    const outcome = await context.settleDirectly(() =>
      verifier.verify({
        jobId: context.claim.jobId,
        workerId: context.workerId,
        leaseToken: context.claim.leaseToken,
        articleId: job,
      }),
    );

    logger.info("stage.verified", {
      job_id: context.claim.jobId,
      url: outcome.url,
      passed: outcome.passed,
      status: outcome.status,
      failed_checks: outcome.checks
        .filter((check) => check.outcome === "failed")
        .map((check) => check.name),
    });
  }

  return { research, draft, revision, images, audit, publish, verify };
}
