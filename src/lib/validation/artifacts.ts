import { z } from "zod";

const sourceKeySchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/);
const jurisdictionSchema = z.string().regex(/^[A-Z]{2,6}$/);
const dateSchema = z.string().date();

export const researchSourceSchema = z
  .object({
    sourceKey: sourceKeySchema,
    url: z.url({ protocol: /^https?$/ }).max(2048),
    title: z.string().trim().min(1).max(500),
    publisher: z.string().trim().min(1).max(200).nullable().default(null),
    publishedOn: dateSchema.nullable().default(null),
    sourceType: z.enum([
      "regulator",
      "government",
      "central_bank",
      "legislation",
      "company_filing",
      "company",
      "statistics",
      "academic",
      "news",
      "other",
    ]),
    quality: z.enum(["primary", "secondary", "tertiary"]),
    jurisdiction: jurisdictionSchema.nullable().default(null),
    accessedAt: z.string().datetime({ offset: true }),
    excerpt: z.string().max(2000).nullable().default(null),
    isPrivate: z.boolean().default(false),
  })
  .strict();

export const researchClaimSchema = z
  .object({
    claimKey: sourceKeySchema,
    text: z.string().trim().min(1).max(2000),
    status: z.enum(["unverified", "supported", "contradicted", "mixed"]),
    confidence: z.number().min(0).max(1).nullable().default(null),
    jurisdiction: jurisdictionSchema.nullable().default(null),
    effectiveDate: dateSchema.nullable().default(null),
    asOfDate: dateSchema.nullable().default(null),
    entities: z.array(z.string().trim().min(1)).max(50).default([]),
    notes: z.string().max(2000).nullable().default(null),
    evidence: z
      .array(
        z
          .object({
            sourceKey: sourceKeySchema,
            relation: z.enum(["supports", "contradicts", "context"]),
            locator: z.string().max(500).nullable().default(null),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

export const researchPacketOutputSchema = z
  .object({
    topicInterpretation: z.string().trim().min(1).max(2000),
    angle: z.string().trim().min(1).max(2000),
    facts: z.array(z.string().trim().min(1).max(2000)).max(100),
    claims: z.array(researchClaimSchema).max(100),
    statistics: z.array(z.string().trim().min(1).max(1000)).max(50),
    dates: z.array(z.string().trim().min(1).max(500)).max(50),
    entities: z.array(z.string().trim().min(1).max(300)).max(100),
    sources: z.array(researchSourceSchema).min(1).max(100),
    contradictions: z.array(z.string().trim().min(1).max(2000)).max(50),
    uncertainties: z.array(z.string().trim().min(1).max(2000)).max(50),
    questions: z.array(z.string().trim().min(1).max(1000)).max(50),
    recommendedStructure: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  })
  .strict()
  .superRefine((packet, context) => {
    const sourceKeys = new Set(packet.sources.map((source) => source.sourceKey));
    if (sourceKeys.size !== packet.sources.length) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "source keys must be unique",
      });
    }
    const claimKeys = new Set(packet.claims.map((claim) => claim.claimKey));
    if (claimKeys.size !== packet.claims.length) {
      context.addIssue({ code: "custom", path: ["claims"], message: "claim keys must be unique" });
    }
    packet.claims.forEach((claim, claimIndex) => {
      claim.evidence.forEach((evidence, evidenceIndex) => {
        if (!sourceKeys.has(evidence.sourceKey)) {
          context.addIssue({
            code: "custom",
            path: ["claims", claimIndex, "evidence", evidenceIndex, "sourceKey"],
            message: `unknown source key ${evidence.sourceKey}`,
          });
        }
      });
    });
  });

export type ResearchPacketOutput = z.infer<typeof researchPacketOutputSchema>;

export const draftOutputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      .max(120),
    excerpt: z.string().trim().min(1).max(500),
    bodyMarkdown: z.string().trim().min(1).max(200_000),
    metaTitle: z.string().max(70).nullable().default(null),
    metaDescription: z.string().max(320).nullable().default(null),
    category: z.string().max(60).nullable().default(null),
    internalLinks: z
      .array(
        z
          .object({
            href: z.string().startsWith("/"),
            label: z.string().trim().min(1).max(200),
            reason: z.string().max(500).nullable().default(null),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    imageBriefs: z
      .array(
        z
          .object({
            slot: z.number().int().min(0).max(3),
            role: z.enum(["hero", "supporting"]),
            purpose: z.string().trim().min(1).max(500),
            prompt: z.string().trim().min(1).max(10_000),
            altText: z.string().trim().min(1).max(300),
            aspectRatio: z.enum(["16:9", "4:5", "3:2", "1:1"]),
          })
          .strict(),
      )
      .max(4)
      .default([]),
    sourceReferences: z.array(sourceKeySchema).max(100).default([]),
  })
  .strict()
  .superRefine((draft, context) => {
    const slots = new Set(draft.imageBriefs.map((brief) => brief.slot));
    if (slots.size !== draft.imageBriefs.length) {
      context.addIssue({
        code: "custom",
        path: ["imageBriefs"],
        message: "image brief slots must be unique",
      });
    }
    draft.imageBriefs.forEach((brief, index) => {
      if ((brief.slot === 0) !== (brief.role === "hero")) {
        context.addIssue({
          code: "custom",
          path: ["imageBriefs", index, "role"],
          message: "slot 0 is the hero and every other slot is supporting",
        });
      }
    });
  });

export type DraftOutput = z.infer<typeof draftOutputSchema>;

export const auditFindingSchema = z
  .object({
    severity: z.enum(["minor", "major", "critical"]),
    category: z.enum([
      "facts",
      "support",
      "contradiction",
      "source_quality",
      "wording_overlap",
      "ai_style",
      "repetition",
      "grammar",
      "clarity",
      "seo",
      "structure",
      "usefulness",
      "internal_consistency",
      "staleness",
      "jurisdiction",
      "risk_context",
    ]),
    location: z.string().trim().min(1).max(500),
    problem: z.string().trim().min(1).max(2000),
    reason: z.string().trim().min(1).max(2000),
    recommendedCorrection: z.string().trim().min(1).max(2000),
  })
  .strict();

export const auditOutputSchema = z
  .object({
    verdict: z.enum(["PASS", "REVISION_REQUIRED", "NEEDS_HUMAN"]),
    summary: z.string().trim().min(1).max(5000),
    findings: z.array(auditFindingSchema).max(100),
  })
  .strict()
  .superRefine((audit, context) => {
    if (audit.verdict !== "PASS" && audit.findings.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["findings"],
        message: `${audit.verdict} requires at least one finding`,
      });
    }
  });

export type AuditOutput = z.infer<typeof auditOutputSchema>;

export const imageArtifactSchema = z
  .object({
    slot: z.number().int().min(0).max(3),
    role: z.enum(["hero", "supporting"]),
    purpose: z.string().max(500).nullable().default(null),
    prompt: z.string().max(10_000).nullable().default(null),
    altText: z.string().max(300).nullable().default(null),
    caption: z.string().max(500).nullable().default(null),
    aspectRatio: z.enum(["16:9", "4:5", "3:2", "1:1"]),
    focalX: z.number().min(0).max(100).nullable().default(null),
    focalY: z.number().min(0).max(100).nullable().default(null),
    width: z.number().int().min(1).max(20_000).nullable().default(null),
    height: z.number().int().min(1).max(20_000).nullable().default(null),
    mimeType: z
      .enum(["image/png", "image/jpeg", "image/webp", "image/avif"])
      .nullable()
      .default(null),
    byteSize: z.number().int().min(1).max(10_485_760).nullable().default(null),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
    status: z.enum(["briefed", "uploaded", "ready", "published", "rejected"]),
    privatePath: z
      .string()
      .regex(/^jobs\/[0-9a-f-]{36}\//)
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((image, context) => {
    if ((image.slot === 0) !== (image.role === "hero")) {
      context.addIssue({ code: "custom", path: ["role"], message: "slot 0 is the hero" });
    }
    if ((image.focalX === null) !== (image.focalY === null)) {
      context.addIssue({
        code: "custom",
        path: ["focalY"],
        message: "focal coordinates must be both present or both absent",
      });
    }
    if (
      ["ready", "published"].includes(image.status) &&
      (!image.altText?.trim() || !image.privatePath || !image.mimeType)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "ready images require alt text, a private path, and a MIME type",
      });
    }
  });

export type ImageArtifact = z.infer<typeof imageArtifactSchema>;

export const ARTIFACT_SCHEMA_VERSIONS = Object.freeze({
  research: "research-1",
  draft: "draft-1",
  audit: "audit-1",
  image: "image-1",
});
