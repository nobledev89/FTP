import { z } from "zod";

import {
  auditOutputSchema,
  draftOutputSchema,
  researchPacketOutputSchema,
  type AuditOutput,
  type DraftOutput,
  type ResearchPacketOutput,
} from "@/lib/validation/artifacts";
import type { Database } from "@/lib/supabase/database.types";

type PipelineStage = Database["public"]["Enums"]["pipeline_stage"];

export type ManualTextOutput = ResearchPacketOutput | DraftOutput | AuditOutput;

const MAX_RESPONSE_CHARACTERS = 1_000_000;

function withoutOuterFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

function issueMessage(error: z.ZodError): string {
  return error.issues
    .slice(0, 12)
    .map(
      (issue) => `${issue.path.length > 0 ? issue.path.join(".") : "response"}: ${issue.message}`,
    )
    .join("\n");
}

export function parseManualTextOutput(
  stage: PipelineStage,
  response: string,
): Readonly<{ ok: true; value: ManualTextOutput } | { ok: false; error: string }> {
  if (response.length === 0) return { ok: false, error: "Paste the provider response first." };
  if (response.length > MAX_RESPONSE_CHARACTERS) {
    return { ok: false, error: "The response is larger than the 1,000,000 character limit." };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(withoutOuterFence(response));
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    return { ok: false, error: `The response is not valid JSON: ${message}` };
  }

  const schema =
    stage === "research"
      ? researchPacketOutputSchema
      : stage === "draft" || stage === "revision"
        ? draftOutputSchema
        : stage === "audit"
          ? auditOutputSchema
          : null;
  if (!schema) return { ok: false, error: `${stage} does not accept a pasted JSON response.` };

  const parsed = schema.safeParse(decoded);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : {
        ok: false,
        error: `The response does not match the expected schema:\n${issueMessage(parsed.error)}`,
      };
}

export const manualImageMetadataSchema = z
  .object({
    slot: z.coerce.number().int().min(0).max(3),
    role: z.enum(["hero", "supporting"]),
    purpose: z.string().trim().min(1).max(500),
    prompt: z.string().trim().min(1).max(10_000),
    altText: z.string().trim().min(1).max(300),
    caption: z
      .string()
      .trim()
      .max(500)
      .transform((value) => (value.length > 0 ? value : null)),
    aspectRatio: z.enum(["16:9", "4:5", "3:2", "1:1"]),
    focalX: z
      .union([z.literal(""), z.coerce.number().min(0).max(100)])
      .transform((value) => (value === "" ? null : value)),
    focalY: z
      .union([z.literal(""), z.coerce.number().min(0).max(100)])
      .transform((value) => (value === "" ? null : value)),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.slot === 0) !== (value.role === "hero")) {
      context.addIssue({ code: "custom", path: ["role"], message: "slot 0 is the hero" });
    }
    if ((value.focalX === null) !== (value.focalY === null)) {
      context.addIssue({
        code: "custom",
        path: ["focalY"],
        message: "enter both focal coordinates or leave both blank",
      });
    }
  });

export function manualValidationError(error: z.ZodError): string {
  return issueMessage(error);
}
