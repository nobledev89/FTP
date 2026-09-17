import { z } from "zod";

import { jobStatusSchema, timestampSchema, uuidSchema } from "./domain";

const expectedLockVersionSchema = z.number().int().nonnegative();
const noteSchema = z.string().trim().min(3).max(2000);

export const adminTransitionCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("start"),
      jobId: uuidSchema,
      expectedLockVersion: expectedLockVersionSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("pause"),
      jobId: uuidSchema,
      expectedLockVersion: expectedLockVersionSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("resume"),
      jobId: uuidSchema,
      expectedLockVersion: expectedLockVersionSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("retry"),
      jobId: uuidSchema,
      expectedLockVersion: expectedLockVersionSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("mark_needs_human"),
      jobId: uuidSchema,
      expectedLockVersion: expectedLockVersionSchema,
      note: noteSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("resolve"),
      jobId: uuidSchema,
      expectedLockVersion: expectedLockVersionSchema,
      note: noteSchema,
      toStatus: jobStatusSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("schedule"),
      jobId: uuidSchema,
      expectedLockVersion: expectedLockVersionSchema,
      desiredPublishAt: timestampSchema.optional(),
    })
    .strict(),
]);

export type AdminTransitionCommand = z.infer<typeof adminTransitionCommandSchema>;

export const transitionResultSchema = z
  .object({ status: jobStatusSchema, lock_version: expectedLockVersionSchema })
  .strict();

export type TransitionResult = z.infer<typeof transitionResultSchema>;
