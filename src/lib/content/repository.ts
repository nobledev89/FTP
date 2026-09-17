import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json } from "@/lib/supabase/database.types";
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
} from "@/lib/validation/artifacts";
import {
  articleJobSchema,
  jobEventSchema,
  jobStatusSchema,
  jsonObjectSchema,
  uuidSchema,
  type ArticleJob,
  type JobEvent,
} from "@/lib/validation/domain";

import {
  ArtifactVersionConflictError,
  isUniqueConstraintError,
  nextArtifactVersion,
  type VersionedArtifactKind,
} from "./versioning";

type Client = SupabaseClient<Database>;
type ArtifactRef = Readonly<{ id: string; version: number }>;

const nullableUuidSchema = uuidSchema.nullable().optional();
const expectedVersionSchema = z.number().int().nonnegative().default(0);

const artifactContextSchema = z
  .object({
    jobId: uuidSchema,
    providerRunId: nullableUuidSchema,
    promptTemplateId: nullableUuidSchema,
    promptVersion: z.number().int().positive().nullable().optional(),
    expectedLatestVersion: expectedVersionSchema,
  })
  .strict();

function parseArtifactContext(input: z.input<typeof artifactContextSchema>) {
  return artifactContextSchema.parse({
    jobId: input.jobId,
    providerRunId: input.providerRunId,
    promptTemplateId: input.promptTemplateId,
    promptVersion: input.promptVersion,
    expectedLatestVersion: input.expectedLatestVersion,
  });
}

const appendEventInputSchema = z
  .object({
    jobId: uuidSchema,
    eventType: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/),
    fromStatus: jobStatusSchema.nullable().default(null),
    toStatus: jobStatusSchema.nullable().default(null),
    actorType: z.enum(["system", "worker", "admin"]),
    actorId: z.string().max(64).nullable().default(null),
    lockVersion: z.number().int().nonnegative().nullable().default(null),
    note: z.string().max(2000).nullable().default(null),
    metadata: jsonObjectSchema.default({}),
  })
  .strict()
  .superRefine((event, context) => {
    if (
      event.fromStatus !== null &&
      event.toStatus !== null &&
      event.fromStatus !== event.toStatus
    ) {
      context.addIssue({
        code: "custom",
        path: ["toStatus"],
        message: "status-changing events are appended only by database transition functions",
      });
    }
  });

export type AppendEventInput = z.input<typeof appendEventInputSchema>;

export type AppendResearchInput = z.input<typeof artifactContextSchema> & {
  packet: ResearchPacketOutput;
  summary?: string | null;
};

export type AppendDraftInput = z.input<typeof artifactContextSchema> & {
  draft: DraftOutput;
  researchPacketId: string;
  parentDraftId?: string | null;
  respondsToAuditId?: string | null;
};

export type AppendAuditInput = z.input<typeof artifactContextSchema> & {
  audit: AuditOutput;
  draftId: string;
  cycle: number;
};

export type AppendImageInput = Pick<
  z.input<typeof artifactContextSchema>,
  "jobId" | "providerRunId" | "expectedLatestVersion"
> & {
  image: ImageArtifact;
};

export interface EditorialReadRepository {
  getJob(jobId: string): Promise<ArticleJob | null>;
  listJobEvents(jobId: string): Promise<readonly JobEvent[]>;
}

/** Worker-only writes. Construct this repository only with the local service-role client. */
export interface ArtifactWriteRepository {
  appendEvent(input: AppendEventInput): Promise<JobEvent>;
  appendResearch(input: AppendResearchInput): Promise<ArtifactRef>;
  appendDraft(input: AppendDraftInput): Promise<ArtifactRef>;
  appendAudit(input: AppendAuditInput): Promise<ArtifactRef>;
  appendImage(input: AppendImageInput): Promise<ArtifactRef>;
}

export type ContentRepository = EditorialReadRepository & ArtifactWriteRepository;

function databaseFailure(error: unknown): Error {
  if (error && typeof error === "object" && "message" in error) {
    return new Error(String(error.message), { cause: error });
  }
  return new Error("The content repository request failed", { cause: error });
}

async function latestVersion(
  client: Client,
  kind: VersionedArtifactKind,
  jobId: string,
  slot?: number,
): Promise<number> {
  let result: { data: Array<{ version: number }> | null; error: unknown };
  switch (kind) {
    case "research":
      result = await client
        .from("research_packets")
        .select("version")
        .eq("job_id", jobId)
        .order("version", { ascending: false })
        .limit(1);
      break;
    case "draft":
      result = await client
        .from("drafts")
        .select("version")
        .eq("job_id", jobId)
        .order("version", { ascending: false })
        .limit(1);
      break;
    case "audit":
      result = await client
        .from("audits")
        .select("version")
        .eq("job_id", jobId)
        .order("version", { ascending: false })
        .limit(1);
      break;
    case "image": {
      if (slot === undefined) throw new TypeError("an image slot is required");
      result = await client
        .from("images")
        .select("version")
        .eq("job_id", jobId)
        .eq("slot", slot)
        .order("version", { ascending: false })
        .limit(1);
      break;
    }
  }
  if (result.error) throw databaseFailure(result.error);
  return result.data?.[0]?.version ?? 0;
}

async function versionForAppend(
  client: Client,
  kind: VersionedArtifactKind,
  jobId: string,
  expectedLatestVersion: number,
  slot?: number,
): Promise<number> {
  const actual = await latestVersion(client, kind, jobId, slot);
  return nextArtifactVersion(kind, actual, expectedLatestVersion);
}

async function insertVersioned(
  operation: PromiseLike<{ data: ArtifactRef | null; error: unknown }>,
  conflictContext: {
    client: Client;
    kind: VersionedArtifactKind;
    jobId: string;
    expectedLatestVersion: number;
    slot?: number;
  },
): Promise<ArtifactRef> {
  const { data, error } = await operation;
  if (error) {
    if (isUniqueConstraintError(error)) {
      const actual = await latestVersion(
        conflictContext.client,
        conflictContext.kind,
        conflictContext.jobId,
        conflictContext.slot,
      );
      throw new ArtifactVersionConflictError(
        conflictContext.kind,
        conflictContext.expectedLatestVersion,
        actual,
        { cause: error },
      );
    }
    throw databaseFailure(error);
  }
  if (!data) throw new Error("The artifact insert returned no row");
  return data;
}

export function createSupabaseContentRepository(client: Client): ContentRepository {
  return {
    async getJob(jobId) {
      const id = uuidSchema.parse(jobId);
      const { data, error } = await client
        .from("article_jobs")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw databaseFailure(error);
      return data ? articleJobSchema.parse(data) : null;
    },

    async listJobEvents(jobId) {
      const id = uuidSchema.parse(jobId);
      const { data, error } = await client
        .from("job_events")
        .select("*")
        .eq("job_id", id)
        .order("id", { ascending: true });
      if (error) throw databaseFailure(error);
      return jobEventSchema.array().parse(data ?? []);
    },

    async appendEvent(input) {
      const event = appendEventInputSchema.parse(input);
      const { data, error } = await client
        .from("job_events")
        .insert({
          job_id: event.jobId,
          event_type: event.eventType,
          from_status: event.fromStatus,
          to_status: event.toStatus,
          actor_type: event.actorType,
          actor_id: event.actorId,
          lock_version: event.lockVersion,
          note: event.note,
          metadata: event.metadata as Json,
        })
        .select("*")
        .single();
      if (error) throw databaseFailure(error);
      return jobEventSchema.parse(data);
    },

    async appendResearch(input) {
      const context = parseArtifactContext(input);
      const packet = researchPacketOutputSchema.parse(input.packet);
      const summary = z
        .string()
        .max(5000)
        .nullable()
        .parse(input.summary ?? null);
      const version = await versionForAppend(
        client,
        "research",
        context.jobId,
        context.expectedLatestVersion,
      );
      return insertVersioned(
        client
          .from("research_packets")
          .insert({
            job_id: context.jobId,
            version,
            packet: packet as Json,
            summary,
            provider_run_id: context.providerRunId ?? null,
            prompt_template_id: context.promptTemplateId ?? null,
            prompt_version: context.promptVersion ?? null,
            schema_version: ARTIFACT_SCHEMA_VERSIONS.research,
            validation_status: "valid",
          })
          .select("id, version")
          .single(),
        {
          client,
          kind: "research",
          jobId: context.jobId,
          expectedLatestVersion: context.expectedLatestVersion,
        },
      );
    },

    async appendDraft(input) {
      const context = parseArtifactContext(input);
      const draft = draftOutputSchema.parse(input.draft);
      const providerRunId = uuidSchema.parse(context.providerRunId);
      const researchPacketId = uuidSchema.parse(input.researchPacketId);
      const parentDraftId = nullableUuidSchema.parse(input.parentDraftId);
      const respondsToAuditId = nullableUuidSchema.parse(input.respondsToAuditId);
      const version = await versionForAppend(
        client,
        "draft",
        context.jobId,
        context.expectedLatestVersion,
      );
      return insertVersioned(
        client
          .from("drafts")
          .insert({
            job_id: context.jobId,
            version,
            research_packet_id: researchPacketId,
            parent_draft_id: parentDraftId ?? null,
            responds_to_audit_id: respondsToAuditId ?? null,
            title: draft.title,
            slug: draft.slug,
            excerpt: draft.excerpt,
            body_markdown: draft.bodyMarkdown,
            meta_title: draft.metaTitle,
            meta_description: draft.metaDescription,
            category: draft.category,
            internal_links: draft.internalLinks as Json,
            image_briefs: draft.imageBriefs as Json,
            source_refs: draft.sourceReferences as Json,
            provider_run_id: providerRunId,
            prompt_template_id: context.promptTemplateId ?? null,
            prompt_version: context.promptVersion ?? null,
            schema_version: ARTIFACT_SCHEMA_VERSIONS.draft,
            validation_status: "valid",
          })
          .select("id, version")
          .single(),
        {
          client,
          kind: "draft",
          jobId: context.jobId,
          expectedLatestVersion: context.expectedLatestVersion,
        },
      );
    },

    async appendAudit(input) {
      const context = parseArtifactContext(input);
      const audit = auditOutputSchema.parse(input.audit);
      const draftId = uuidSchema.parse(input.draftId);
      const cycle = z.number().int().min(0).max(2).parse(input.cycle);
      const version = await versionForAppend(
        client,
        "audit",
        context.jobId,
        context.expectedLatestVersion,
      );
      return insertVersioned(
        client
          .from("audits")
          .insert({
            job_id: context.jobId,
            version,
            draft_id: draftId,
            cycle,
            verdict: audit.verdict,
            findings: audit.findings as Json,
            summary: audit.summary,
            provider_run_id: context.providerRunId ?? null,
            prompt_template_id: context.promptTemplateId ?? null,
            prompt_version: context.promptVersion ?? null,
            schema_version: ARTIFACT_SCHEMA_VERSIONS.audit,
          })
          .select("id, version")
          .single(),
        {
          client,
          kind: "audit",
          jobId: context.jobId,
          expectedLatestVersion: context.expectedLatestVersion,
        },
      );
    },

    async appendImage(input) {
      const context = z
        .object({
          jobId: uuidSchema,
          providerRunId: nullableUuidSchema,
          expectedLatestVersion: expectedVersionSchema,
        })
        .strict()
        .parse({
          jobId: input.jobId,
          providerRunId: input.providerRunId,
          expectedLatestVersion: input.expectedLatestVersion,
        });
      const image = imageArtifactSchema.parse(input.image);
      const version = await versionForAppend(
        client,
        "image",
        context.jobId,
        context.expectedLatestVersion,
        image.slot,
      );
      return insertVersioned(
        client
          .from("images")
          .insert({
            job_id: context.jobId,
            slot: image.slot,
            version,
            role: image.role,
            purpose: image.purpose,
            prompt: image.prompt,
            alt_text: image.altText,
            caption: image.caption,
            aspect_ratio: image.aspectRatio,
            focal_x: image.focalX,
            focal_y: image.focalY,
            width: image.width,
            height: image.height,
            mime_type: image.mimeType,
            byte_size: image.byteSize,
            content_hash: image.contentHash,
            status: image.status,
            private_path: image.privatePath,
            provider_run_id: context.providerRunId ?? null,
          })
          .select("id, version")
          .single(),
        {
          client,
          kind: "image",
          jobId: context.jobId,
          expectedLatestVersion: context.expectedLatestVersion,
          slot: image.slot,
        },
      );
    },
  };
}
