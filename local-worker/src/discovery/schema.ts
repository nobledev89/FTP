import { z } from "zod";

/**
 * What the topic-discovery prompt returns (`discovery-1`). The database re-validates everything it
 * stores; this schema rejects malformed output before any job is proposed.
 */

export const DISCOVERY_SCHEMA_VERSION = "discovery-1";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

export const discoverySuggestionSchema = z
  .object({
    categorySlug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    topic: z.string().trim().min(10).max(160),
    articleType: z.enum(["news", "analysis", "explainer", "guide"]),
    angle: z.string().trim().min(20).max(1500),
    keywords: z.array(z.string().trim().min(2).max(60)).min(1).max(8),
    source: z
      .object({
        headline: z.string().trim().min(3).max(300),
        url: z
          .string()
          .trim()
          .max(2000)
          .regex(/^https:\/\/[^\s/]+\.[^\s]+$/, "must be an https URL"),
        publisher: z.string().trim().min(1).max(120),
        publishedAt: isoDate,
      })
      .strict(),
  })
  .strict();

export const discoveryOutputSchema = z
  .object({ suggestions: z.array(discoverySuggestionSchema).max(24) })
  .strict();

export type DiscoverySuggestion = z.infer<typeof discoverySuggestionSchema>;
export type DiscoveryOutput = z.infer<typeof discoveryOutputSchema>;
