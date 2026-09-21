import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "../db/database.types.js";
import { unwrapResult, WorkerDatabaseError } from "../db/worker-store.js";
import type { StructuredLogger } from "../logging/logger.js";
import { safeSummary } from "../logging/redact.js";
import { renderTemplate, type JsonObject } from "../providers/contract.js";
import type { StructuredCli } from "../providers/cli/base.js";
import { providerJsonSchema } from "../providers/cli/structured-output.js";
import {
  DISCOVERY_SCHEMA_VERSION,
  discoveryOutputSchema,
  type DiscoveryOutput,
  type DiscoverySuggestion,
} from "./schema.js";

/**
 * Topic discovery: turns recent real news into started article jobs.
 *
 * The database decides whether a scan is due and which categories still owe an article today
 * (`worker_begin_topic_discovery`), and it enforces every quota again when a job is created. This
 * service only asks Codex, with live web search, for one story per due category, filters out
 * anything stale, duplicated, or for a category that was not asked for, and hands the survivors
 * to `worker_create_discovered_job`. A failed scan is recorded on its run row and never throws
 * into the job queue; the next interval simply tries again.
 */

export type DueCategory = Readonly<{
  id: string;
  slug: string;
  name: string;
  guidance: string;
  dailyTarget: number;
  createdToday: number;
}>;

export type RecentTopic = Readonly<{ category: string; topic: string; url: string | null }>;

export type DiscoveryDue = Readonly<{
  runId: number;
  siteId: string;
  siteName: string;
  timezone: string;
  today: string;
  categories: readonly DueCategory[];
  recentTopics: readonly RecentTopic[];
}>;

export type DiscoveryTemplates = Readonly<{ discovery: string | null; styleGuide: string | null }>;

export type DiscoveredJobInput = Readonly<{
  runId: number;
  workerId: string;
  categoryId: string;
  suggestion: DiscoverySuggestion;
}>;

export type DiscoveryFinish = Readonly<{
  succeeded: boolean;
  candidates?: number;
  error?: string;
  usage?: JsonObject;
}>;

export interface DiscoveryStore {
  begin(workerId: string): Promise<DiscoveryDue | null>;
  templates(siteId: string): Promise<DiscoveryTemplates>;
  /** The new job id, or null when the quota was met meanwhile or the story was used before. */
  createJob(input: DiscoveredJobInput): Promise<string | null>;
  finish(runId: number, workerId: string, result: DiscoveryFinish): Promise<void>;
}

export type DiscoveryOutcome =
  | Readonly<{ state: "idle" }>
  | Readonly<{ state: "completed"; runId: number; candidates: number; created: readonly string[] }>
  | Readonly<{ state: "failed"; runId: number; error: string }>;

/** Most categories want news from the last three days; an explainer may hang on a fortnight-old one. */
const MAX_AGE_DAYS: Readonly<Record<string, number>> = { explainers: 14 };
const DEFAULT_MAX_AGE_DAYS = 3;

function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  return Math.round(
    (Date.parse(`${toIsoDate}T00:00:00Z`) - Date.parse(`${fromIsoDate}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * At most one suggestion per due category, in the order Codex ranked them. Stale, future-dated,
 * already-covered, and unrequested stories are dropped. Exported for tests.
 */
export function selectSuggestions(
  output: DiscoveryOutput,
  due: DiscoveryDue,
): readonly Readonly<{ category: DueCategory; suggestion: DiscoverySuggestion }>[] {
  const categories = new Map(due.categories.map((category) => [category.slug, category]));
  const coveredUrls = new Set(due.recentTopics.map((topic) => topic.url).filter(Boolean));
  const chosen = new Map<string, DiscoverySuggestion>();
  const usedUrls = new Set<string>();

  for (const suggestion of output.suggestions) {
    const category = categories.get(suggestion.categorySlug);
    if (!category || chosen.has(category.slug)) continue;
    const url = suggestion.source.url;
    if (coveredUrls.has(url) || usedUrls.has(url)) continue;
    const age = daysBetween(suggestion.source.publishedAt, due.today);
    if (
      Number.isNaN(age) ||
      age < -1 ||
      age > (MAX_AGE_DAYS[category.slug] ?? DEFAULT_MAX_AGE_DAYS)
    ) {
      continue;
    }
    chosen.set(category.slug, suggestion);
    usedUrls.add(url);
  }

  return due.categories.flatMap((category) => {
    const suggestion = chosen.get(category.slug);
    return suggestion ? [{ category, suggestion }] : [];
  });
}

/** Renders the reviewed template with the scan's context. Exported for tests. */
export function discoveryPrompt(due: DiscoveryDue, templates: DiscoveryTemplates): string {
  if (!templates.discovery) {
    throw new Error("The topic-discovery prompt template is missing; run the prompt seed.");
  }
  const categories = due.categories
    .map(
      (category) =>
        `- \`${category.slug}\` — **${category.name}**: ${category.guidance} ` +
        `(target ${category.dailyTarget} a day; ${category.createdToday} created so far today)`,
    )
    .join("\n");
  const recent =
    due.recentTopics.length === 0
      ? "None yet."
      : due.recentTopics
          .slice(0, 60)
          .map(
            (topic) => `- [${topic.category}] ${topic.topic}${topic.url ? ` — ${topic.url}` : ""}`,
          )
          .join("\n");
  return renderTemplate(templates.discovery, {
    styleGuide: templates.styleGuide ?? "",
    siteName: due.siteName,
    today: due.today,
    timezone: due.timezone,
    categories,
    recentTopics: recent,
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
  });
}

export class TopicDiscoveryService {
  private schema: Record<string, unknown> | null = null;

  constructor(
    private readonly store: DiscoveryStore,
    private readonly cli: Pick<StructuredCli, "runStructured">,
    private readonly workerId: string,
    private readonly logger: StructuredLogger,
  ) {}

  async runIfDue(signal: AbortSignal): Promise<DiscoveryOutcome> {
    const due = await this.store.begin(this.workerId);
    if (!due) return { state: "idle" };

    const log = this.logger.child({ discovery_run: due.runId });
    log.info("discovery.started", { categories: due.categories.map((category) => category.slug) });

    let usage: JsonObject = {};
    try {
      const templates = await this.store.templates(due.siteId);
      this.schema ??= providerJsonSchema(discoveryOutputSchema);
      const result = await this.cli.runStructured({
        stage: "discovery",
        prompt: discoveryPrompt(due, templates),
        schema: this.schema,
        signal,
      });
      usage = result.usage;
      const parsed = discoveryOutputSchema.safeParse(result.value);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        throw new Error(`Codex returned discovery output that does not match: ${issues}`);
      }

      const created: string[] = [];
      for (const { category, suggestion } of selectSuggestions(parsed.data, due)) {
        signal.throwIfAborted();
        const jobId = await this.store.createJob({
          runId: due.runId,
          workerId: this.workerId,
          categoryId: category.id,
          suggestion,
        });
        if (jobId) {
          created.push(jobId);
          log.info("discovery.job_created", {
            job_id: jobId,
            category: category.slug,
            source_url: suggestion.source.url,
          });
        }
      }

      const candidates = parsed.data.suggestions.length;
      await this.store.finish(due.runId, this.workerId, { succeeded: true, candidates, usage });
      log.info("discovery.finished", { candidates, created: created.length });
      return { state: "completed", runId: due.runId, candidates, created };
    } catch (error) {
      const summary = safeSummary(error);
      try {
        await this.store.finish(due.runId, this.workerId, {
          succeeded: false,
          error: summary,
          usage,
        });
      } catch (finishError) {
        log.warn("discovery.finish_failed", { error: finishError });
      }
      if (signal.aborted) throw error;
      log.warn("discovery.failed", { error: summary });
      return { state: "failed", runId: due.runId, error: summary };
    }
  }
}

type Client = SupabaseClient<Database>;

const dueCategoryRow = (value: unknown): DueCategory => {
  const row = value as Record<string, unknown>;
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    guidance: String(row.guidance),
    dailyTarget: Number(row.daily_target),
    createdToday: Number(row.created_today),
  };
};

const recentTopicRow = (value: unknown): RecentTopic => {
  const row = value as Record<string, unknown>;
  return {
    category: String(row.category),
    topic: String(row.topic),
    url: typeof row.url === "string" ? row.url : null,
  };
};

export class SupabaseDiscoveryStore implements DiscoveryStore {
  constructor(private readonly client: Client) {}

  async begin(workerId: string): Promise<DiscoveryDue | null> {
    const { data, error } = await this.client.rpc("worker_begin_topic_discovery", {
      p_worker_id: workerId,
    });
    if (error) {
      throw new WorkerDatabaseError("worker_begin_topic_discovery", error.code, error.message, {
        cause: error,
      });
    }
    const row = data?.[0];
    if (!row) return null;
    return {
      runId: row.run_id,
      siteId: row.site_id,
      siteName: row.site_name,
      timezone: row.timezone,
      today: row.today,
      categories: (Array.isArray(row.categories) ? row.categories : []).map(dueCategoryRow),
      recentTopics: (Array.isArray(row.recent_topics) ? row.recent_topics : []).map(recentTopicRow),
    };
  }

  async templates(siteId: string): Promise<DiscoveryTemplates> {
    const rows = unwrapResult(
      await this.client
        .from("prompt_templates")
        .select("key, content")
        .eq("site_id", siteId)
        .eq("is_active", true)
        .in("key", ["topic-discovery", "editorial-style"]),
      "load discovery prompt templates",
    );
    return {
      discovery: rows.find((row) => row.key === "topic-discovery")?.content ?? null,
      styleGuide: rows.find((row) => row.key === "editorial-style")?.content ?? null,
    };
  }

  async createJob(input: DiscoveredJobInput): Promise<string | null> {
    const { suggestion } = input;
    const { data, error } = await this.client.rpc("worker_create_discovered_job", {
      p_run_id: input.runId,
      p_worker_id: input.workerId,
      p_category_id: input.categoryId,
      p_topic: suggestion.topic,
      p_article_type: suggestion.articleType,
      p_keywords: suggestion.keywords,
      p_requirements: suggestion.angle,
      p_source: {
        url: suggestion.source.url,
        headline: suggestion.source.headline,
        publisher: suggestion.source.publisher,
        published_at: suggestion.source.publishedAt,
      },
    });
    if (error) {
      // Another scan claimed the same story between the check and the insert.
      if (error.code === "23505") return null;
      throw new WorkerDatabaseError("worker_create_discovered_job", error.code, error.message, {
        cause: error,
      });
    }
    return data ?? null;
  }

  async finish(runId: number, workerId: string, result: DiscoveryFinish): Promise<void> {
    const { error } = await this.client.rpc("worker_finish_topic_discovery", {
      p_run_id: runId,
      p_worker_id: workerId,
      p_succeeded: result.succeeded,
      ...(result.candidates === undefined ? {} : { p_candidates: result.candidates }),
      ...(result.error === undefined ? {} : { p_error: result.error }),
      p_usage: (result.usage ?? {}) as Json,
    });
    if (error) {
      throw new WorkerDatabaseError("worker_finish_topic_discovery", error.code, error.message, {
        cause: error,
      });
    }
  }
}
