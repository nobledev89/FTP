import { describe, expect, it } from "vitest";

import { StructuredLogger } from "../logging/logger.js";
import type { DiscoverySuggestion } from "./schema.js";
import {
  discoveryPrompt,
  selectSuggestions,
  TopicDiscoveryService,
  type DiscoveredJobInput,
  type DiscoveryDue,
  type DiscoveryFinish,
  type DiscoveryStore,
} from "./service.js";

const due: DiscoveryDue = {
  runId: 7,
  siteId: "11111111-1111-4111-8111-111111111111",
  siteName: "FinTechPulse",
  timezone: "Europe/London",
  today: "2026-09-21",
  categories: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      slug: "payments",
      name: "Payments",
      guidance: "Payments news.",
      dailyTarget: 2,
      createdToday: 0,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      slug: "explainers",
      name: "Explainers & Guides",
      guidance: "Evergreen pieces.",
      dailyTarget: 1,
      createdToday: 0,
    },
  ],
  recentTopics: [{ category: "payments", topic: "Old story", url: "https://example.com/old" }],
  availableJobSlots: 2,
};

function suggestion(overrides: Partial<DiscoverySuggestion> = {}): DiscoverySuggestion {
  return {
    categorySlug: "payments",
    topic: "UK regulator sets new rules for instant payments",
    articleType: "news",
    angle: "Explain what the new instant payment rules mean for UK consumers and firms.",
    keywords: ["instant payments", "uk"],
    trafficPotential: {
      score: 75,
      audience: "broad",
      searchIntent: "high",
      urgency: "timely",
      rationale: "The rules affect a broad UK payments audience and answer a timely question.",
    },
    source: {
      headline: "Regulator publishes instant payment rules",
      url: "https://example.com/news/instant",
      publisher: "Example News",
      publishedAt: "2026-09-20",
    },
    ...overrides,
  };
}

const quietLogger = new StructuredLogger({}, { write: () => undefined });

describe("selectSuggestions", () => {
  it("keeps the highest-scoring fresh story for each category", () => {
    const chosen = selectSuggestions(
      {
        suggestions: [
          suggestion({ trafficPotential: { ...suggestion().trafficPotential, score: 60 } }),
          suggestion({
            topic: "A higher-potential payments story for the same category",
            source: { ...suggestion().source, url: "https://example.com/news/higher" },
            trafficPotential: { ...suggestion().trafficPotential, score: 90 },
          }),
          suggestion({
            categorySlug: "explainers",
            articleType: "explainer",
            source: {
              ...suggestion().source,
              url: "https://example.com/explainer",
              publishedAt: "2026-09-10",
            },
          }),
        ],
      },
      due,
    );
    expect(
      chosen.map(({ category, suggestion: picked }) => [category.slug, picked.source.url]),
    ).toEqual([
      ["payments", "https://example.com/news/higher"],
      ["explainers", "https://example.com/explainer"],
    ]);
  });

  it("drops stale, future, already-covered, and unrequested stories", () => {
    const source = suggestion().source;
    const chosen = selectSuggestions(
      {
        suggestions: [
          suggestion({ source: { ...source, publishedAt: "2026-09-15" } }),
          suggestion({ source: { ...source, publishedAt: "2026-09-25" } }),
          suggestion({ source: { ...source, url: "https://example.com/old" } }),
          suggestion({ categorySlug: "open-banking" }),
        ],
      },
      due,
    );
    expect(chosen).toEqual([]);
  });
});

describe("discoveryPrompt", () => {
  it("lists the due categories and the stories already covered", () => {
    const prompt = discoveryPrompt(due, {
      discovery: "Today {{today}}\n{{categories}}\n{{recentTopics}}\n{{schemaVersion}}",
      styleGuide: null,
    });
    expect(prompt).toContain("Today 2026-09-21");
    expect(prompt).toContain("`payments` — **Payments**");
    expect(prompt).toContain("[payments] Old story — https://example.com/old");
    expect(prompt).toContain("discovery-2");
    expect(prompt).toContain("trafficPotential");
  });

  it("refuses to scan without the reviewed template", () => {
    expect(() => discoveryPrompt(due, { discovery: null, styleGuide: null })).toThrow(/template/);
  });
});

describe("TopicDiscoveryService", () => {
  function harness(options: { value?: unknown; due?: DiscoveryDue | null; fail?: Error } = {}) {
    const created: DiscoveredJobInput[] = [];
    const finished: DiscoveryFinish[] = [];
    const deferred: string[] = [];
    const prompts: string[] = [];
    const store: DiscoveryStore = {
      begin: async () => (options.due === undefined ? due : options.due),
      templates: async () => ({ discovery: "{{categories}}", styleGuide: null }),
      createJob: async (input) => {
        created.push(input);
        return `job-${created.length}`;
      },
      deferUsageLimit: async (_siteId, _workerId, summary) => {
        deferred.push(summary);
      },
      finish: async (_runId, _workerId, result) => {
        finished.push(result);
      },
    };
    const cli = {
      runStructured: async (request: { prompt: string; stage: string }) => {
        prompts.push(`${request.stage}:${request.prompt}`);
        if (options.fail) throw options.fail;
        return { value: options.value ?? { suggestions: [suggestion()] }, usage: { turns: 1 } };
      },
    };
    const service = new TopicDiscoveryService(store, cli, "home-pc-1", quietLogger);
    return { service, created, deferred, finished, prompts };
  }

  it("does nothing when no scan is due", async () => {
    const { service, prompts } = harness({ due: null });
    expect(await service.runIfDue(new AbortController().signal)).toEqual({ state: "idle" });
    expect(prompts).toEqual([]);
  });

  it("asks Codex with web search, creates the chosen jobs, and closes the run", async () => {
    const { service, created, finished, prompts } = harness();
    const outcome = await service.runIfDue(new AbortController().signal);

    expect(outcome).toEqual({ state: "completed", runId: 7, candidates: 1, created: ["job-1"] });
    expect(prompts[0]).toMatch(/^discovery:/);
    expect(created).toEqual([
      expect.objectContaining({
        runId: 7,
        categoryId: due.categories[0]!.id,
        workerId: "home-pc-1",
      }),
    ]);
    expect(finished).toEqual([{ succeeded: true, candidates: 1, usage: { turns: 1 } }]);
  });

  it("records a failed scan without throwing into the queue", async () => {
    const { service, deferred, finished } = harness({
      fail: new Error("You've hit your usage limit."),
    });
    const outcome = await service.runIfDue(new AbortController().signal);
    expect(outcome).toMatchObject({ state: "failed", runId: 7 });
    expect(finished[0]).toMatchObject({
      succeeded: false,
      error: expect.stringContaining("usage limit"),
    });
    expect(deferred[0]).toContain("usage limit");
  });

  it("rejects malformed Codex output and creates nothing", async () => {
    const { service, created, finished } = harness({ value: { suggestions: [{ topic: "x" }] } });
    expect(await service.runIfDue(new AbortController().signal)).toMatchObject({ state: "failed" });
    expect(created).toEqual([]);
    expect(finished[0]).toMatchObject({ succeeded: false });
  });
});
