import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ARTIFACT_SCHEMA_VERSIONS,
  auditOutputSchema,
  draftOutputSchema,
  imageArtifactSchema,
  researchPacketOutputSchema,
  type AuditOutput,
  type DraftOutput,
  type ImageArtifact,
  type ResearchPacketOutput,
} from "../contracts/artifacts.js";
import type { PreparedRun, PromptTemplate, StageBrief, StageFile } from "../providers/contract.js";

import type { Database, Json } from "./database.types.js";
import { WorkerDatabaseError, unwrapResult } from "./worker-store.js";

/**
 * Artifact persistence for the worker (ADR 0003).
 *
 * Adapters return typed data and nothing else. Everything here — provider run rows, artifact
 * versions, source and claim graphs, Storage uploads — is the stage service's responsibility, so
 * there is exactly one place that decides what a provider result is allowed to become.
 */

type Client = SupabaseClient<Database>;
type Enums = Database["public"]["Enums"];
type PipelineStage = Enums["pipeline_stage"];
type ProviderMode = Enums["provider_mode"];
type ErrorClass = Enums["error_class"];
type ArticleType = Enums["article_type"];

const WORK_BUCKET = "article-work";

export type JobContext = Readonly<{
  brief: StageBrief;
  siteId: string;
  canonicalOrigin: string;
  templates: ReadonlyMap<string, PromptTemplate>;
  styleGuide: string | null;
  approvedDraftId: string | null;
  revisionCount: number;
}>;

export type ArtifactRef = Readonly<{ id: string; version: number }>;

export type ResearchArtifact = Readonly<{
  id: string;
  version: number;
  packet: ResearchPacketOutput;
}>;

export type DraftArtifact = Readonly<{
  id: string;
  version: number;
  researchPacketId: string;
  draft: DraftOutput;
}>;

export type AuditArtifact = Readonly<{
  id: string;
  version: number;
  draftId: string;
  cycle: number;
  audit: AuditOutput;
}>;

export type RunRecord = Readonly<{ id: string; idempotencyKey: string }>;

/** The calendar date in `timeZone`, as YYYY-MM-DD. */
export function dateInTimeZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof WorkerDatabaseError && typeof error.code === "string" && error.code === "23505"
  );
}

export class ArtifactStore {
  constructor(private readonly client: Client) {}

  // -------------------------------------------------------------------------
  // Job context
  // -------------------------------------------------------------------------

  /** Loads the brief, the site, and every active prompt template in one pass per table. */
  async loadJobContext(jobId: string, now: Date = new Date()): Promise<JobContext> {
    const job = unwrapResult(
      await this.client
        .from("article_jobs")
        .select(
          "id, site_id, topic, keywords, requirements, article_type, category, target_word_count, image_count, approved_draft_id, revision_count",
        )
        .eq("id", jobId)
        .single(),
      "load job",
    );

    const site = unwrapResult(
      await this.client
        .from("sites")
        .select("id, name, timezone, canonical_origin")
        .eq("id", job.site_id)
        .single(),
      "load site",
    );

    const templateRows = unwrapResult(
      await this.client
        .from("prompt_templates")
        .select("id, key, version, content")
        .eq("site_id", job.site_id)
        .eq("is_active", true),
      "load prompt templates",
    );

    const templates = new Map<string, PromptTemplate>(
      templateRows.map((row) => [
        row.key,
        { id: row.id, key: row.key, version: row.version, content: row.content },
      ]),
    );

    return {
      brief: {
        jobId: job.id,
        topic: job.topic,
        keywords: job.keywords,
        requirements: job.requirements,
        articleType: job.article_type as ArticleType,
        category: job.category,
        targetWordCount: job.target_word_count,
        imageCount: job.image_count,
        siteName: site.name,
        timezone: site.timezone,
        // Prompts are dated in the publication's timezone, not the worker PC's.
        today: dateInTimeZone(now, site.timezone),
      },
      siteId: site.id,
      canonicalOrigin: site.canonical_origin,
      templates,
      styleGuide: templates.get("editorial-style")?.content ?? null,
      approvedDraftId: job.approved_draft_id,
      revisionCount: job.revision_count,
    };
  }

  /** The publication linkage is kept on the private job row, not on the public article snapshot. */
  async articleIdFor(jobId: string): Promise<string | null> {
    const job = unwrapResult(
      await this.client.from("article_jobs").select("article_id").eq("id", jobId).single(),
      "load published article linkage",
    );
    return job.article_id;
  }

  // -------------------------------------------------------------------------
  // Provider runs
  // -------------------------------------------------------------------------

  /**
   * Opens a provider run. The idempotency key is derived from the job, stage, cycle, and attempt,
   * so a worker that crashed after inserting the row rejoins the same run instead of opening a
   * second one for the same attempt.
   */
  async beginRun(
    prepared: PreparedRun,
    run: Readonly<{
      jobId: string;
      stage: PipelineStage;
      cycle: number;
      attempt: number;
      workerId: string;
    }>,
  ): Promise<RunRecord> {
    const row = {
      job_id: run.jobId,
      stage: run.stage,
      provider: prepared.provider,
      mode: prepared.mode,
      cycle: run.cycle,
      attempt: run.attempt,
      idempotency_key: prepared.idempotencyKey,
      prompt_template_id: prepared.promptTemplateId,
      prompt_version: prepared.promptVersion,
      prompt_snapshot: prepared.prompt.slice(0, 400_000),
      schema_version: prepared.schemaVersion,
      input_refs: prepared.inputRefs as Json,
      status: "running" as const,
      worker_id: run.workerId,
    };

    try {
      const inserted = unwrapResult(
        await this.client.from("provider_runs").insert(row).select("id, idempotency_key").single(),
        "open provider run",
      );
      return { id: inserted.id, idempotencyKey: inserted.idempotency_key };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = unwrapResult(
        await this.client
          .from("provider_runs")
          .select("id, idempotency_key")
          .eq("idempotency_key", prepared.idempotencyKey)
          .single(),
        "reopen provider run",
      );
      return { id: existing.id, idempotencyKey: existing.idempotency_key };
    }
  }

  async succeedRun(
    runId: string,
    outcome: Readonly<{
      outputRef?: Record<string, Json>;
      usage?: Record<string, Json>;
      cost?: Readonly<{ amount: number; currency: string }>;
    }> = {},
  ): Promise<void> {
    unwrapResult(
      await this.client
        .from("provider_runs")
        .update({
          status: "succeeded",
          finished_at: new Date().toISOString(),
          output_ref: (outcome.outputRef ?? {}) as Json,
          usage: (outcome.usage ?? null) as Json,
          cost_amount: outcome.cost?.amount ?? null,
          cost_currency: outcome.cost?.currency ?? null,
        })
        .eq("id", runId)
        .select("id")
        .single(),
      "finish provider run",
    );
  }

  async failRun(
    runId: string,
    failure: Readonly<{ errorClass: ErrorClass; summary: string; retryable: boolean }>,
  ): Promise<void> {
    unwrapResult(
      await this.client
        .from("provider_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error_class: failure.errorClass,
          error_summary: failure.summary.slice(0, 2000),
          retryable: failure.retryable,
        })
        .eq("id", runId)
        .select("id")
        .single(),
      "fail provider run",
    );
  }

  /** Marks a run as waiting for an operator. `request_manual_action` moves the job itself. */
  async awaitManualAction(runId: string): Promise<void> {
    unwrapResult(
      await this.client
        .from("provider_runs")
        .update({ status: "action_required" })
        .eq("id", runId)
        .select("id")
        .single(),
      "mark provider run action required",
    );
  }

  // -------------------------------------------------------------------------
  // Research
  // -------------------------------------------------------------------------

  /**
   * Writes a research packet with its sources, claims, and the evidence edges between them.
   *
   * Sources are written before the packet is usable so that a draft's `source_refs` can hold real
   * source ids: the publication source list is built by joining those ids, and a draft that stored
   * provider-supplied keys would publish with an empty list.
   */
  async saveResearch(
    input: Readonly<{
      jobId: string;
      runId: string;
      packet: ResearchPacketOutput;
      summary: string;
      template: PromptTemplate | null;
    }>,
  ): Promise<ResearchArtifact & { sourceIdsByKey: ReadonlyMap<string, string> }> {
    const packet = researchPacketOutputSchema.parse(input.packet);
    const version = (await this.latestVersion("research_packets", input.jobId)) + 1;

    const packetRow = unwrapResult(
      await this.client
        .from("research_packets")
        .insert({
          job_id: input.jobId,
          version,
          packet: packet as unknown as Json,
          summary: input.summary.slice(0, 5000),
          provider_run_id: input.runId,
          prompt_template_id: input.template?.id ?? null,
          prompt_version: input.template?.version ?? null,
          schema_version: ARTIFACT_SCHEMA_VERSIONS.research,
          validation_status: "valid",
        })
        .select("id, version")
        .single(),
      "insert research packet",
    );

    const sourceRows = unwrapResult(
      await this.client
        .from("sources")
        .insert(
          packet.sources.map((source) => ({
            job_id: input.jobId,
            research_packet_id: packetRow.id,
            source_key: source.sourceKey,
            url: source.url,
            title: source.title,
            publisher: source.publisher,
            published_on: source.publishedOn,
            source_type: source.sourceType,
            quality: source.quality,
            jurisdiction: source.jurisdiction,
            accessed_at: source.accessedAt,
            excerpt: source.excerpt,
            is_private: source.isPrivate,
          })),
        )
        .select("id, source_key"),
      "insert sources",
    );

    const sourceIdsByKey = new Map(sourceRows.map((row) => [row.source_key, row.id]));

    if (packet.claims.length > 0) {
      const claimRows = unwrapResult(
        await this.client
          .from("claims")
          .insert(
            packet.claims.map((claim) => ({
              job_id: input.jobId,
              research_packet_id: packetRow.id,
              claim_key: claim.claimKey,
              text: claim.text,
              status: claim.status,
              confidence: claim.confidence,
              jurisdiction: claim.jurisdiction,
              effective_date: claim.effectiveDate,
              as_of_date: claim.asOfDate,
              entities: claim.entities,
              notes: claim.notes,
            })),
          )
          .select("id, claim_key"),
        "insert claims",
      );

      const claimIdsByKey = new Map(claimRows.map((row) => [row.claim_key, row.id]));
      const edges = packet.claims.flatMap((claim) =>
        claim.evidence.flatMap((evidence) => {
          const claimId = claimIdsByKey.get(claim.claimKey);
          const sourceId = sourceIdsByKey.get(evidence.sourceKey);
          if (!claimId || !sourceId) return [];
          return [
            {
              claim_id: claimId,
              source_id: sourceId,
              research_packet_id: packetRow.id,
              relation: evidence.relation,
              locator: evidence.locator,
            },
          ];
        }),
      );

      if (edges.length > 0) {
        // A claim may cite the same source twice with different locators; the primary key is
        // (claim, source), so the first edge wins rather than failing the whole packet.
        const seen = new Set<string>();
        const unique = edges.filter((edge) => {
          const key = `${edge.claim_id}:${edge.source_id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        unwrapResult(
          await this.client.from("claim_sources").insert(unique).select("claim_id"),
          "insert claim evidence",
        );
      }
    }

    return { id: packetRow.id, version: packetRow.version, packet, sourceIdsByKey };
  }

  async latestResearch(jobId: string): Promise<ResearchArtifact | null> {
    const rows = unwrapResult(
      await this.client
        .from("research_packets")
        .select("id, version, packet")
        .eq("job_id", jobId)
        .eq("validation_status", "valid")
        .order("version", { ascending: false })
        .limit(1),
      "load latest research packet",
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      version: row.version,
      packet: researchPacketOutputSchema.parse(row.packet),
    };
  }

  /** Maps this packet's source keys to the stored source ids. */
  async sourceIdsFor(researchPacketId: string): Promise<ReadonlyMap<string, string>> {
    const rows = unwrapResult(
      await this.client
        .from("sources")
        .select("id, source_key, is_private")
        .eq("research_packet_id", researchPacketId),
      "load sources",
    );
    return new Map(rows.filter((row) => !row.is_private).map((row) => [row.source_key, row.id]));
  }

  // -------------------------------------------------------------------------
  // Drafts
  // -------------------------------------------------------------------------

  async saveDraft(
    input: Readonly<{
      jobId: string;
      runId: string;
      draft: DraftOutput;
      researchPacketId: string;
      parentDraftId: string | null;
      respondsToAuditId: string | null;
      sourceIdsByKey: ReadonlyMap<string, string>;
      template: PromptTemplate | null;
    }>,
  ): Promise<DraftArtifact> {
    const draft = draftOutputSchema.parse(input.draft);
    const version = (await this.latestVersion("drafts", input.jobId)) + 1;

    // Publication joins source_refs to sources by id. A key with no stored source is dropped
    // rather than published as a dangling reference.
    const sourceRefs = draft.sourceReferences
      .map((key) => input.sourceIdsByKey.get(key))
      .filter((id): id is string => typeof id === "string");

    const row = unwrapResult(
      await this.client
        .from("drafts")
        .insert({
          job_id: input.jobId,
          version,
          origin: "provider",
          parent_draft_id: input.parentDraftId,
          research_packet_id: input.researchPacketId,
          responds_to_audit_id: input.respondsToAuditId,
          title: draft.title,
          slug: draft.slug,
          excerpt: draft.excerpt,
          body_markdown: draft.bodyMarkdown,
          meta_title: draft.metaTitle,
          meta_description: draft.metaDescription,
          category: draft.category,
          internal_links: draft.internalLinks as unknown as Json,
          image_briefs: draft.imageBriefs as unknown as Json,
          source_refs: sourceRefs as unknown as Json,
          provider_run_id: input.runId,
          prompt_template_id: input.template?.id ?? null,
          prompt_version: input.template?.version ?? null,
          schema_version: ARTIFACT_SCHEMA_VERSIONS.draft,
          validation_status: "valid",
        })
        .select("id, version")
        .single(),
      "insert draft",
    );

    return {
      id: row.id,
      version: row.version,
      researchPacketId: input.researchPacketId,
      draft,
    };
  }

  async latestDraft(jobId: string): Promise<DraftArtifact | null> {
    const rows = unwrapResult(
      await this.client
        .from("drafts")
        .select(
          "id, version, research_packet_id, title, slug, excerpt, body_markdown, meta_title, meta_description, category, internal_links, image_briefs, source_refs",
        )
        .eq("job_id", jobId)
        .eq("validation_status", "valid")
        .order("version", { ascending: false })
        .limit(1),
      "load latest draft",
    );
    const row = rows[0];
    if (!row) return null;

    // source_refs holds stored source ids; the draft contract speaks in provider source keys, so
    // the keys are re-read from the sources table rather than reconstructed.
    const keys = unwrapResult(
      await this.client
        .from("sources")
        .select("id, source_key")
        .eq("research_packet_id", row.research_packet_id),
      "load source keys",
    );
    const keyById = new Map(keys.map((source) => [source.id, source.source_key]));
    const ids = Array.isArray(row.source_refs) ? row.source_refs : [];

    return {
      id: row.id,
      version: row.version,
      researchPacketId: row.research_packet_id,
      draft: draftOutputSchema.parse({
        title: row.title,
        slug: row.slug,
        excerpt: row.excerpt,
        bodyMarkdown: row.body_markdown,
        metaTitle: row.meta_title,
        metaDescription: row.meta_description,
        category: row.category,
        internalLinks: row.internal_links,
        imageBriefs: row.image_briefs,
        sourceReferences: ids
          .map((id) => (typeof id === "string" ? keyById.get(id) : undefined))
          .filter((key): key is string => typeof key === "string"),
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Audits
  // -------------------------------------------------------------------------

  async saveAudit(
    input: Readonly<{
      jobId: string;
      runId: string;
      audit: AuditOutput;
      draftId: string;
      cycle: number;
      template: PromptTemplate | null;
    }>,
  ): Promise<AuditArtifact> {
    const audit = auditOutputSchema.parse(input.audit);
    const version = (await this.latestVersion("audits", input.jobId)) + 1;

    const row = unwrapResult(
      await this.client
        .from("audits")
        .insert({
          job_id: input.jobId,
          version,
          draft_id: input.draftId,
          cycle: input.cycle,
          verdict: audit.verdict,
          findings: audit.findings as unknown as Json,
          summary: audit.summary,
          provider_run_id: input.runId,
          prompt_template_id: input.template?.id ?? null,
          prompt_version: input.template?.version ?? null,
          schema_version: ARTIFACT_SCHEMA_VERSIONS.audit,
        })
        .select("id, version")
        .single(),
      "insert audit",
    );

    return {
      id: row.id,
      version: row.version,
      draftId: input.draftId,
      cycle: input.cycle,
      audit,
    };
  }

  async latestAudit(jobId: string): Promise<AuditArtifact | null> {
    const rows = unwrapResult(
      await this.client
        .from("audits")
        .select("id, version, draft_id, cycle, verdict, findings, summary")
        .eq("job_id", jobId)
        .order("version", { ascending: false })
        .limit(1),
      "load latest audit",
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      version: row.version,
      draftId: row.draft_id,
      cycle: row.cycle,
      audit: auditOutputSchema.parse({
        verdict: row.verdict,
        summary: row.summary ?? "",
        findings: row.findings,
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Images
  // -------------------------------------------------------------------------

  /**
   * Uploads the bytes to the private working bucket and records the image as `ready`.
   *
   * The path includes the content hash, so re-running an attempt writes the same object and the
   * upload is idempotent. Only the stage service knows the path; the adapter never sees it.
   */
  async saveImage(
    input: Readonly<{
      jobId: string;
      runId: string;
      artifact: ImageArtifact;
      file: StageFile;
    }>,
  ): Promise<ArtifactRef> {
    const artifact = imageArtifactSchema.parse(input.artifact);
    const extension =
      artifact.mimeType === "image/png"
        ? "png"
        : artifact.mimeType === "image/jpeg"
          ? "jpg"
          : artifact.mimeType === "image/webp"
            ? "webp"
            : artifact.mimeType === "image/avif"
              ? "avif"
              : "bin";
    const privatePath = `jobs/${input.jobId}/images/slot-${artifact.slot}-${(
      artifact.contentHash ?? "nohash"
    ).slice(0, 16)}.${extension}`;

    const upload = await this.client.storage
      .from(WORK_BUCKET)
      .upload(privatePath, input.file.bytes, {
        contentType: input.file.mimeType,
        upsert: true,
      });
    if (upload.error) {
      throw new WorkerDatabaseError("upload image", undefined, upload.error.message, {
        cause: upload.error,
      });
    }

    const version = (await this.latestImageVersion(input.jobId, artifact.slot)) + 1;
    const row = unwrapResult(
      await this.client
        .from("images")
        .insert({
          job_id: input.jobId,
          slot: artifact.slot,
          version,
          role: artifact.role,
          purpose: artifact.purpose,
          prompt: artifact.prompt,
          alt_text: artifact.altText,
          caption: artifact.caption,
          aspect_ratio: artifact.aspectRatio,
          focal_x: artifact.focalX,
          focal_y: artifact.focalY,
          width: artifact.width,
          height: artifact.height,
          mime_type: artifact.mimeType,
          byte_size: artifact.byteSize,
          content_hash: artifact.contentHash,
          status: "ready",
          private_path: privatePath,
          provider_run_id: input.runId,
        })
        .select("id, version")
        .single(),
      "insert image",
    );

    return { id: row.id, version: row.version };
  }

  /** Images ready to publish, newest version per slot. */
  async readyImages(
    jobId: string,
  ): Promise<
    readonly Readonly<{ id: string; slot: number; privatePath: string; mimeType: string }>[]
  > {
    const rows = unwrapResult(
      await this.client
        .from("images")
        .select("id, slot, version, private_path, mime_type, status")
        .eq("job_id", jobId)
        .in("status", ["ready", "published"])
        .order("slot", { ascending: true })
        .order("version", { ascending: false }),
      "load ready images",
    );

    const bySlot = new Map<number, (typeof rows)[number]>();
    for (const row of rows) {
      if (!bySlot.has(row.slot)) bySlot.set(row.slot, row);
    }
    return [...bySlot.values()]
      .filter((row) => row.private_path !== null && row.mime_type !== null)
      .map((row) => ({
        id: row.id,
        slot: row.slot,
        privatePath: row.private_path as string,
        mimeType: row.mime_type as string,
      }));
  }

  // -------------------------------------------------------------------------
  // Shared
  // -------------------------------------------------------------------------

  private async latestVersion(
    table: "research_packets" | "drafts" | "audits",
    jobId: string,
  ): Promise<number> {
    const rows = unwrapResult(
      await this.client
        .from(table)
        .select("version")
        .eq("job_id", jobId)
        .order("version", { ascending: false })
        .limit(1),
      `load latest ${table} version`,
    );
    return rows[0]?.version ?? 0;
  }

  private async latestImageVersion(jobId: string, slot: number): Promise<number> {
    const rows = unwrapResult(
      await this.client
        .from("images")
        .select("version")
        .eq("job_id", jobId)
        .eq("slot", slot)
        .order("version", { ascending: false })
        .limit(1),
      "load latest image version",
    );
    return rows[0]?.version ?? 0;
  }
}

export type { ProviderMode, PipelineStage };
