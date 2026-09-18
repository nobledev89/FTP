import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ArtifactStore } from "../../local-worker/src/db/artifact-store.js";
import type { Database as WorkerDatabase } from "../../local-worker/src/db/database.types.js";
import { createWorkerClient, SupabaseWorkerStore } from "../../local-worker/src/db/worker-store.js";
import { StructuredLogger } from "../../local-worker/src/logging/logger.js";
import { createPipelineHandlers } from "../../local-worker/src/pipeline/handlers.js";
import {
  createCliAdapters,
  type CliAdapterSet,
} from "../../local-worker/src/providers/cli/adapters.js";
import {
  createFakeCli,
  type FakeCli,
  type FakeCliScenario,
} from "../../local-worker/src/providers/cli/testing/fake-cli.js";
import type { RunContext } from "../../local-worker/src/providers/contract.js";
import { buildAudit } from "../../local-worker/src/providers/mock/audit.js";
import { buildDraft } from "../../local-worker/src/providers/mock/draft.js";
import { buildImages } from "../../local-worker/src/providers/mock/images.js";
import { buildResearchPacket } from "../../local-worker/src/providers/mock/research.js";
import { PublishingService } from "../../local-worker/src/publishing/publish.js";
import { WorkerRunner } from "../../local-worker/src/queue/runner.js";
import { bodyProbe, VerificationService } from "../../local-worker/src/verification/verify.js";

import { adminUser, closeDb, resetWorkflowData, serviceClient } from "./helpers/clients";
import { localSupabase } from "./helpers/env";
import { adminAction, createJob, events, jobRow, unwrap, type JobStatus } from "./helpers/workflow";

import type { WorkerEnv } from "../../local-worker/src/config/env.js";
import type { TestUser } from "./helpers/clients";

let editor: TestUser;
let viewer: TestUser;

beforeAll(async () => {
  editor = await adminUser("editor");
  viewer = await adminUser("viewer");
});

beforeEach(resetWorkflowData);
afterAll(closeDb);

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function workerEnv(maxAttempts = 5): WorkerEnv {
  const local = localSupabase();
  return {
    SUPABASE_URL: local.apiUrl,
    SUPABASE_SERVICE_ROLE_KEY: local.secretKey,
    PUBLIC_SITE_URL: "http://localhost:3000",
    REVALIDATION_SECRET: "integration-revalidation-secret-value",
    WORKER_ID: "mock-pipeline-worker",
    WORKER_POLL_INTERVAL_MS: 250,
    WORKER_HEARTBEAT_INTERVAL_MS: 1_000,
    WORKER_OFFLINE_AFTER_SECONDS: 120,
    WORKER_LEASE_SECONDS: 30,
    WORKER_MAX_ATTEMPTS: maxAttempts,
    WORKER_SHUTDOWN_TIMEOUT_MS: 2_000,
    PUBLISH_VERIFY_TIMEOUT_MS: 5_000,
    CODEX_BIN: "codex",
    CLAUDE_BIN: "claude",
    CLI_TIMEOUT_MS: 1_200_000,
  };
}

function pipeline(
  maxAttempts = 5,
  cli?: CliAdapterSet,
): {
  runner: WorkerRunner;
  client: SupabaseClient<WorkerDatabase>;
} {
  const env = workerEnv(maxAttempts);
  // Use the same worker-only client constructor the real CLI uses; this keeps auth and headers
  // identical to production rather than borrowing an admin test client.
  const client = createWorkerClient(env);
  const store = new SupabaseWorkerStore(client);
  const artifacts = new ArtifactStore(client);
  const fetchPage = (async (input: RequestInfo | URL) => {
    const requestUrl = input instanceof Request ? input.url : input.toString();
    const slug = new URL(requestUrl).pathname.split("/").filter(Boolean).at(-1);
    const { data: article, error } = await client
      .from("articles")
      .select("slug, title, meta_description, body_markdown, canonical_url, hero_image")
      .eq("slug", slug ?? "")
      .single();
    if (error) throw error;

    const probe = bodyProbe(article.body_markdown);
    const hero = article.hero_image
      ? '<img src="/storage/v1/object/public/article-public/hero.png" alt="Editorial mock image">'
      : "";
    const html = `<!doctype html><html><head>
      <title>${escapeHtml(article.title)} | FinTechPulse</title>
      <link rel="canonical" href="${escapeHtml(article.canonical_url)}">
      <meta name="description" content="${escapeHtml(article.meta_description)}">
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Article",
        headline: article.title,
      })}</script>
      </head><body><main><article><h1>${escapeHtml(article.title)}</h1>${hero}
      <p>${escapeHtml(probe)}. ${"Rendered editorial copy ".repeat(20)}</p>
      </article></main></body></html>`;
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
  }) as typeof fetch;

  const handlers = createPipelineHandlers({
    store: artifacts,
    publisher: new PublishingService(client, artifacts),
    verifier: new VerificationService(client, {
      publicSiteUrl: env.PUBLIC_SITE_URL,
      timeoutMs: env.PUBLISH_VERIFY_TIMEOUT_MS,
      fetchPage,
    }),
    ...(cli ? { cli } : {}),
    logger: new StructuredLogger({}, { write() {} }),
    now: () => new Date("2026-09-18T09:00:00Z"),
  });
  const runner = new WorkerRunner({
    env,
    store,
    handlers,
    logger: new StructuredLogger({}, { write() {} }),
    random: () => 0,
  });
  return { runner, client };
}

function manualContext(
  jobId: string,
  stage: RunContext["stage"],
  mode: RunContext["mode"],
  cycle = 0,
): RunContext {
  return {
    stage,
    mode,
    cycle,
    attempt: 1,
    claimVersion: 1,
    brief: {
      jobId,
      topic: "Manual open banking workflow",
      keywords: ["payments", "uk"],
      requirements: null,
      articleType: "analysis",
      category: "Payments",
      targetWordCount: 900,
      imageCount: 1,
      siteName: "FinTechPulse",
      timezone: "Europe/London",
      today: "2026-09-18",
    },
    template: null,
    styleGuide: null,
    schemaVersion:
      stage === "research"
        ? "research-1"
        : stage === "audit"
          ? "audit-1"
          : stage === "images"
            ? "image-1"
            : "draft-1",
  };
}

async function driveTo(
  runner: WorkerRunner,
  jobId: string,
  wanted: JobStatus,
  maximumCycles = 20,
): Promise<readonly string[]> {
  const states: string[] = [];
  for (let cycle = 0; cycle < maximumCycles; cycle += 1) {
    if ((await jobRow(jobId)).status === wanted) return states;
    states.push((await runner.runOnce()).state);
  }
  throw new Error(`job ${jobId} did not reach ${wanted}; it is ${(await jobRow(jobId)).status}`);
}

async function waitForStatus(jobId: string, wanted: JobStatus): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await jobRow(jobId)).status === wanted) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`job ${jobId} did not enter ${wanted}`);
}

describe("deterministic mock pipeline", () => {
  it("uses the real stores and publication boundary to reach VERIFIED", async () => {
    const jobId = await createJob(editor, {
      topic: "Open banking payment rules",
      imageCount: 1,
      autoPublish: true,
    });
    await unwrap(adminAction(editor, jobId, "start"));
    const { runner, client } = pipeline();

    const states = await driveTo(runner, jobId, "VERIFIED");
    expect(states).toEqual(Array(6).fill("completed"));

    const job = await jobRow(jobId);
    expect(job).toMatchObject({ status: "VERIFIED", revision_count: 0, lease_token: null });
    expect(job.article_id).not.toBeNull();

    const [runs, research, drafts, audits, images, logs] = await Promise.all([
      editor.client
        .from("provider_runs")
        .select("stage, status, prompt_version, prompt_snapshot")
        .eq("job_id", jobId)
        .order("created_at"),
      editor.client.from("research_packets").select("id, version").eq("job_id", jobId),
      editor.client.from("drafts").select("id, version").eq("job_id", jobId),
      editor.client.from("audits").select("id, version, verdict").eq("job_id", jobId),
      editor.client
        .from("images")
        .select("id, version, status, private_path, public_path")
        .eq("job_id", jobId),
      editor.client.from("publishing_logs").select("kind, outcome").eq("job_id", jobId),
    ]);
    for (const result of [runs, research, drafts, audits, images, logs]) {
      expect(result.error).toBeNull();
    }
    expect(runs.data?.map((run) => run.stage)).toEqual(["research", "draft", "images", "audit"]);
    expect(runs.data?.every((run) => run.status === "succeeded")).toBe(true);
    expect(runs.data?.every((run) => run.prompt_version === 1)).toBe(true);
    expect(runs.data?.every((run) => (run.prompt_snapshot?.length ?? 0) > 100)).toBe(true);
    expect(research.data).toHaveLength(1);
    expect(drafts.data).toHaveLength(1);
    expect(audits.data).toEqual([expect.objectContaining({ version: 1, verdict: "PASS" })]);
    expect(images.data).toEqual([expect.objectContaining({ version: 1, status: "published" })]);
    expect(logs.data?.filter((log) => log.kind === "publish")).toHaveLength(1);
    expect(logs.data?.filter((log) => log.kind === "verify_check")).toHaveLength(8);
    expect(logs.data?.filter((log) => log.kind === "verify_summary")).toHaveLength(1);

    const publicPath = images.data?.[0]?.public_path;
    expect(publicPath).toMatch(/^articles\/open-banking-payment-rules\//);
    const downloaded = await client.storage.from("article-public").download(publicPath!);
    expect(downloaded.error).toBeNull();
    expect([...new Uint8Array(await downloaded.data!.arrayBuffer()).slice(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const timeline = await events(jobId);
    expect(timeline.map((event) => event.event_type)).toEqual(
      expect.arrayContaining(["job.started", "job.published", "job.verified"]),
    );
  });

  it("creates a new draft and audit version when the first audit requests revision", async () => {
    const jobId = await createJob(editor, {
      topic: "UK card payment safeguards",
      imageCount: 0,
      autoPublish: true,
      keywords: ["payments", "mock:audit=revision"],
    });
    await unwrap(adminAction(editor, jobId, "start"));
    const { runner } = pipeline();

    await driveTo(runner, jobId, "VERIFIED");
    expect(await jobRow(jobId)).toMatchObject({ status: "VERIFIED", revision_count: 1 });

    const drafts = await unwrap(
      editor.client
        .from("drafts")
        .select("version, parent_draft_id, responds_to_audit_id")
        .eq("job_id", jobId)
        .order("version"),
    );
    const audits = await unwrap(
      editor.client
        .from("audits")
        .select("version, verdict, cycle")
        .eq("job_id", jobId)
        .order("version"),
    );
    const runs = await unwrap(
      editor.client.from("provider_runs").select("stage").eq("job_id", jobId).order("created_at"),
    );
    expect(drafts).toHaveLength(2);
    expect(drafts[1]).toMatchObject({
      version: 2,
      parent_draft_id: expect.any(String),
      responds_to_audit_id: expect.any(String),
    });
    expect(audits).toEqual([
      expect.objectContaining({ version: 1, cycle: 0, verdict: "REVISION_REQUIRED" }),
      expect.objectContaining({ version: 2, cycle: 1, verdict: "PASS" }),
    ]);
    expect(runs.map((run) => run.stage)).toEqual([
      "research",
      "draft",
      "audit",
      "revision",
      "audit",
    ]);
  });

  it("records a controlled provider failure through the normal FAILED path", async () => {
    const jobId = await createJob(editor, {
      topic: "Simulated provider outage",
      imageCount: 0,
      keywords: ["mock:fail=research"],
    });
    await unwrap(adminAction(editor, jobId, "start"));
    const { runner } = pipeline(1);

    await expect(runner.runOnce()).resolves.toMatchObject({ state: "failed" });
    expect(await jobRow(jobId)).toMatchObject({ status: "FAILED", failed_stage: "research" });
    const runs = await unwrap(
      editor.client
        .from("provider_runs")
        .select("status, error_class, retryable")
        .eq("job_id", jobId),
    );
    expect(runs).toEqual([
      expect.objectContaining({ status: "failed", error_class: "transient", retryable: true }),
    ]);
  });

  it("releases manual work without a lease and surfaces the action in the admin data", async () => {
    const jobId = await createJob(editor, {
      topic: "Manual research handoff",
      imageCount: 0,
      keywords: ["mock:manual=research"],
    });
    await unwrap(adminAction(editor, jobId, "start"));
    const { runner } = pipeline();

    await expect(runner.runOnce()).resolves.toMatchObject({ state: "completed" });
    expect(await jobRow(jobId)).toMatchObject({
      status: "RESEARCHING",
      lease_token: null,
      action_required_kind: "manual_input",
      action_required_run_id: expect.any(String),
    });
    const runs = await unwrap(
      editor.client.from("provider_runs").select("status").eq("job_id", jobId),
    );
    expect(runs).toEqual([{ status: "action_required" }]);
    expect((await events(jobId)).map((event) => event.event_type)).toContain("action.required");
  });

  it("completes the full pipeline through manual subscription handoffs without CLI or API keys", async () => {
    const jobId = await createJob(editor, {
      topic: "Manual open banking workflow",
      imageCount: 1,
      autoPublish: true,
      researchMode: "manual_chatgpt",
      writingMode: "manual_claude",
      imagesMode: "manual_gemini",
      auditMode: "manual_chatgpt",
    });
    await unwrap(adminAction(editor, jobId, "start"));
    const { runner, client } = pipeline();

    await expect(runner.runOnce()).resolves.toMatchObject({ state: "completed" });
    let job = await jobRow(jobId);
    expect(job).toMatchObject({ status: "RESEARCHING", action_required_kind: "manual_input" });
    const researchRunId = job.action_required_run_id!;
    const packet = buildResearchPacket(manualContext(jobId, "research", "manual_chatgpt"));
    const importedResearch = await unwrap(
      editor.client.rpc("admin_import_manual_result", {
        p_job_id: jobId,
        p_run_id: researchRunId,
        p_output: packet,
      }),
    );
    expect(importedResearch[0]).toMatchObject({ imported_stage: "research", artifact_version: 1 });
    const duplicate = await editor.client.rpc("admin_import_manual_result", {
      p_job_id: jobId,
      p_run_id: researchRunId,
      p_output: packet,
    });
    expect(duplicate.error?.code).toBe("FT004");

    await expect(runner.runOnce()).resolves.toMatchObject({ state: "completed" });
    job = await jobRow(jobId);
    expect(job.status).toBe("DRAFTING");
    const draftRunId = job.action_required_run_id!;
    const articleDraft = buildDraft(manualContext(jobId, "draft", "manual_claude"), { packet });
    await unwrap(
      editor.client.rpc("admin_import_manual_result", {
        p_job_id: jobId,
        p_run_id: draftRunId,
        p_output: articleDraft,
      }),
    );

    await expect(runner.runOnce()).resolves.toMatchObject({ state: "completed" });
    job = await jobRow(jobId);
    expect(job.status).toBe("IMAGES_PROCESSING");
    const imageRunId = job.action_required_run_id!;
    const generated = buildImages(manualContext(jobId, "images", "manual_gemini"), {
      draft: articleDraft,
      draftVersion: 1,
    });
    const artifact = generated.artifacts[0]!;
    const file = generated.files[0]!;
    const privatePath = `jobs/${jobId}/manual-test/slot-0-${artifact.contentHash!.slice(0, 12)}.png`;
    const uploaded = await editor.client.storage
      .from("article-work")
      .upload(privatePath, file.bytes, {
        contentType: file.mimeType,
        upsert: false,
      });
    expect(uploaded.error).toBeNull();
    await unwrap(
      editor.client.rpc("admin_import_manual_image", {
        p_job_id: jobId,
        p_run_id: imageRunId,
        p_slot: artifact.slot,
        p_metadata: {
          role: artifact.role,
          purpose: artifact.purpose,
          prompt: artifact.prompt,
          altText: artifact.altText,
          caption: artifact.caption,
          aspectRatio: artifact.aspectRatio,
          focalX: artifact.focalX,
          focalY: artifact.focalY,
        },
        p_private_path: privatePath,
        p_mime_type: file.mimeType,
        p_byte_size: file.bytes.byteLength,
        p_content_hash: artifact.contentHash!,
        p_width: file.width,
        p_height: file.height,
      }),
    );
    await unwrap(
      editor.client.rpc("admin_complete_manual_images", {
        p_job_id: jobId,
        p_run_id: imageRunId,
      }),
    );

    await expect(runner.runOnce()).resolves.toMatchObject({ state: "completed" });
    job = await jobRow(jobId);
    expect(job.status).toBe("AUDITING");
    const auditRunId = job.action_required_run_id!;
    const audit = buildAudit(manualContext(jobId, "audit", "manual_chatgpt"), {
      packet,
      draft: articleDraft,
      draftVersion: 1,
    });
    expect(audit.verdict).toBe("PASS");
    await unwrap(
      editor.client.rpc("admin_import_manual_result", {
        p_job_id: jobId,
        p_run_id: auditRunId,
        p_output: audit,
      }),
    );

    await driveTo(runner, jobId, "VERIFIED", 4);
    expect(await jobRow(jobId)).toMatchObject({ status: "VERIFIED", action_required_kind: null });
    const runs = await unwrap(
      editor.client
        .from("provider_runs")
        .select("stage, mode, status, prompt_snapshot")
        .eq("job_id", jobId)
        .order("created_at"),
    );
    expect(runs.map((run) => [run.stage, run.mode, run.status])).toEqual([
      ["research", "manual_chatgpt", "succeeded"],
      ["draft", "manual_claude", "succeeded"],
      ["images", "manual_gemini", "succeeded"],
      ["audit", "manual_chatgpt", "succeeded"],
    ]);
    expect(runs.every((run) => (run.prompt_snapshot?.length ?? 0) > 100)).toBe(true);
    const publishedImage = await unwrap(
      client
        .from("images")
        .select("status, private_path, public_path")
        .eq("job_id", jobId)
        .single(),
    );
    expect(publishedImage).toMatchObject({
      status: "published",
      private_path: privatePath,
      public_path: expect.stringMatching(/^articles\//),
    });
    expect((await events(jobId)).map((event) => event.event_type)).toEqual(
      expect.arrayContaining([
        "action.required",
        "manual.image_imported",
        "job.published",
        "job.verified",
      ]),
    );
  });

  it("redoes a resolved manual stage in a fresh run and cancels the abandoned one", async () => {
    const jobId = await createJob(editor, {
      imageCount: 0,
      researchMode: "manual_chatgpt",
      writingMode: "manual_claude",
      auditMode: "manual_chatgpt",
    });
    await unwrap(adminAction(editor, jobId, "start"));
    const { runner } = pipeline();

    await runner.runOnce();
    const researchRunId = (await jobRow(jobId)).action_required_run_id!;
    await unwrap(
      editor.client.rpc("admin_import_manual_result", {
        p_job_id: jobId,
        p_run_id: researchRunId,
        p_output: buildResearchPacket(manualContext(jobId, "research", "manual_chatgpt")),
      }),
    );
    await runner.runOnce();
    const draftRunId = (await jobRow(jobId)).action_required_run_id!;
    expect((await jobRow(jobId)).status).toBe("DRAFTING");

    // The editor rejects the accepted research. Resolution resets the attempt counter, so the
    // next claim must not reopen the research run it already finished.
    await unwrap(adminAction(editor, jobId, "mark_needs_human", { note: "Sources are too thin" }));
    await unwrap(
      adminAction(editor, jobId, "resolve", { note: "Redo research", to: "RESEARCH_PENDING" }),
    );
    await expect(runner.runOnce()).resolves.toMatchObject({ state: "completed" });

    const job = await jobRow(jobId);
    expect(job).toMatchObject({ status: "RESEARCHING", action_required_kind: "manual_input" });
    expect(job.action_required_run_id).not.toBe(researchRunId);
    const runs = await unwrap(
      editor.client
        .from("provider_runs")
        .select("id, stage, status")
        .eq("job_id", jobId)
        .order("created_at"),
    );
    expect(runs.map((run) => [run.id, run.stage, run.status])).toEqual([
      [researchRunId, "research", "succeeded"],
      [draftRunId, "draft", "cancelled"],
      [job.action_required_run_id, "research", "action_required"],
    ]);
  });

  it("refuses manual imports that the pipeline could not continue from", async () => {
    const jobId = await createJob(editor, {
      imageCount: 1,
      researchMode: "manual_chatgpt",
      writingMode: "manual_claude",
      imagesMode: "manual_gemini",
      auditMode: "manual_chatgpt",
    });
    await unwrap(adminAction(editor, jobId, "start"));
    const { runner } = pipeline();

    await runner.runOnce();
    const packet = buildResearchPacket(manualContext(jobId, "research", "manual_chatgpt"));
    await unwrap(
      editor.client.rpc("admin_import_manual_result", {
        p_job_id: jobId,
        p_run_id: (await jobRow(jobId)).action_required_run_id!,
        p_output: packet,
      }),
    );
    await runner.runOnce();
    const draftRunId = (await jobRow(jobId)).action_required_run_id!;
    const articleDraft = buildDraft(manualContext(jobId, "draft", "manual_claude"), { packet });

    const unbriefed = await editor.client.rpc("admin_import_manual_result", {
      p_job_id: jobId,
      p_run_id: draftRunId,
      p_output: { ...articleDraft, imageBriefs: [] },
    });
    expect(unbriefed.error).toMatchObject({ code: "22023" });
    expect(unbriefed.error?.message).toContain("image brief");

    const byViewer = await viewer.client.rpc("admin_import_manual_result", {
      p_job_id: jobId,
      p_run_id: draftRunId,
      p_output: articleDraft,
    });
    expect(byViewer.error?.code).toBe("42501");

    // A paused manual wait keeps its run for resume but accepts nothing until then.
    await unwrap(adminAction(editor, jobId, "pause"));
    const whilePaused = await editor.client.rpc("admin_import_manual_result", {
      p_job_id: jobId,
      p_run_id: draftRunId,
      p_output: articleDraft,
    });
    expect(whilePaused.error?.code).toBe("FT001");
    await unwrap(adminAction(editor, jobId, "resume"));
    expect(await jobRow(jobId)).toMatchObject({
      status: "DRAFTING",
      action_required_run_id: draftRunId,
    });
    await unwrap(
      editor.client.rpc("admin_import_manual_result", {
        p_job_id: jobId,
        p_run_id: draftRunId,
        p_output: articleDraft,
      }),
    );

    await runner.runOnce();
    const imageRunId = (await jobRow(jobId)).action_required_run_id!;
    const generated = buildImages(manualContext(jobId, "images", "manual_gemini"), {
      draft: articleDraft,
      draftVersion: 1,
    });
    const artifact = generated.artifacts[0]!;
    const file = generated.files[0]!;
    const privatePath = `jobs/${jobId}/manual-test/slot-0.png`;
    expect(
      (
        await editor.client.storage
          .from("article-work")
          .upload(privatePath, file.bytes, { contentType: file.mimeType })
      ).error,
    ).toBeNull();
    const imageArgs = {
      p_job_id: jobId,
      p_run_id: imageRunId,
      p_slot: 0,
      p_metadata: {
        role: artifact.role,
        purpose: artifact.purpose,
        prompt: artifact.prompt,
        altText: artifact.altText,
        caption: null,
        aspectRatio: artifact.aspectRatio,
        focalX: null,
        focalY: null,
      },
      p_private_path: privatePath,
      p_mime_type: file.mimeType,
      p_byte_size: file.bytes.byteLength,
      p_content_hash: artifact.contentHash!,
      p_width: file.width,
      p_height: file.height,
    };

    const misreported = await editor.client.rpc("admin_import_manual_image", {
      ...imageArgs,
      p_byte_size: file.bytes.byteLength + 1,
    });
    expect(misreported.error?.code).toBe("22023");
    const unrequested = await editor.client.rpc("admin_import_manual_image", {
      ...imageArgs,
      p_slot: 1,
      p_metadata: { ...imageArgs.p_metadata, role: "supporting" },
    });
    expect(unrequested.error?.code).toBe("22023");
    const early = await editor.client.rpc("admin_complete_manual_images", {
      p_job_id: jobId,
      p_run_id: imageRunId,
    });
    expect(early.error?.code).toBe("FT005");

    await unwrap(editor.client.rpc("admin_import_manual_image", imageArgs));
    await unwrap(
      editor.client.rpc("admin_complete_manual_images", { p_job_id: jobId, p_run_id: imageRunId }),
    );
    expect((await jobRow(jobId)).status).toBe("AUDIT_PENDING");
  });

  it("escalates an editorial conflict to NEEDS_HUMAN with its audit attached", async () => {
    const jobId = await createJob(editor, {
      topic: "Conflicting implementation dates",
      imageCount: 0,
      keywords: ["mock:audit=needs_human"],
    });
    await unwrap(adminAction(editor, jobId, "start"));
    const { runner } = pipeline();

    await driveTo(runner, jobId, "NEEDS_HUMAN");
    expect(await jobRow(jobId)).toMatchObject({
      status: "NEEDS_HUMAN",
      needs_human_stage: "audit",
      lease_token: null,
    });
    const audits = await unwrap(
      editor.client.from("audits").select("verdict, findings").eq("job_id", jobId),
    );
    expect(audits).toEqual([
      expect.objectContaining({ verdict: "NEEDS_HUMAN", findings: expect.any(Array) }),
    ]);
    expect((await events(jobId)).map((event) => event.event_type)).toContain("job.needs_human");
  });

  it("fences a paused in-flight stage and safely resumes it from pending", async () => {
    const jobId = await createJob(editor, {
      topic: "Pause and resume the mock worker",
      imageCount: 0,
      keywords: ["mock:slow=250"],
    });
    await unwrap(adminAction(editor, jobId, "start"));
    const { runner } = pipeline();

    const running = runner.runOnce();
    await waitForStatus(jobId, "RESEARCHING");
    await unwrap(adminAction(editor, jobId, "pause"));
    await expect(running).resolves.toMatchObject({ state: "abandoned" });
    expect(await jobRow(jobId)).toMatchObject({
      status: "PAUSED",
      paused_from_status: "RESEARCH_PENDING",
      lease_token: null,
    });

    await unwrap(adminAction(editor, jobId, "resume"));
    await expect(runner.runOnce()).resolves.toMatchObject({ state: "completed" });
    expect((await jobRow(jobId)).status).toBe("DRAFT_PENDING");
    const packets = await unwrap(
      editor.client.from("research_packets").select("version").eq("job_id", jobId).order("version"),
    );
    expect(packets.map((packet) => packet.version)).toEqual([1, 2]);
  });

  it("does not claim scheduled publication before its due time", async () => {
    const jobId = await createJob(editor, {
      topic: "Scheduled mock publication",
      imageCount: 0,
      autoPublish: false,
    });
    await unwrap(adminAction(editor, jobId, "start"));
    const { runner } = pipeline();
    await driveTo(runner, jobId, "APPROVED");
    await expect(runner.runOnce()).resolves.toMatchObject({ state: "idle" });

    const due = new Date(Date.now() + 400).toISOString();
    await unwrap(adminAction(editor, jobId, "schedule", { desiredPublishAt: due }));
    await expect(runner.runOnce()).resolves.toMatchObject({ state: "idle" });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await driveTo(runner, jobId, "VERIFIED");
    expect((await events(jobId)).map((event) => event.event_type)).toContain("job.scheduled");
  });
});

describe("subscription CLI providers", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "fintechpulse-cli-pipeline-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  /**
   * Scripted stand-ins for Claude Code and Codex. The worker's real resolver, process runner,
   * environment allowlist, probes, parsers, stores, and state machine run unchanged; only the
   * model is replaced. The worker environment deliberately contains the service-role key.
   */
  async function fakeClis(
    claude: FakeCliScenario,
    codex: FakeCliScenario,
  ): Promise<{ cli: CliAdapterSet; claudeCli: FakeCli; codexCli: FakeCli }> {
    const claudeCli = await createFakeCli(path.join(directory, "claude"), claude);
    const codexCli = await createFakeCli(path.join(directory, "codex"), codex);
    const cli = createCliAdapters({
      claude: { bin: claudeCli.bin },
      codex: { bin: codexCli.bin },
      runtime: {
        timeoutMs: 30_000,
        tempRoot: directory,
        sourceEnv: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: localSupabase().secretKey },
      },
    });
    return { cli, claudeCli, codexCli };
  }

  /** Schema-valid provider responses for a job, built with the mock builders. */
  function responses(jobId: string, topic: string) {
    const context = (stage: RunContext["stage"]): RunContext => {
      const base = manualContext(jobId, stage, "mock");
      return { ...base, brief: { ...base.brief, topic } };
    };
    const packet = buildResearchPacket(context("research"));
    const draft = buildDraft(context("draft"), { packet });
    const audit = buildAudit(context("audit"), { packet, draft, draftVersion: 1 });
    return { packet, draft, audit };
  }

  it("researches and audits with Codex and writes with Claude Code through to VERIFIED", async () => {
    const topic = "Subscription CLI safeguarding rules";
    const jobId = await createJob(editor, {
      topic,
      imageCount: 1,
      autoPublish: true,
      researchMode: "codex_cli",
      writingMode: "claude_code",
      auditMode: "codex_cli",
    });
    await unwrap(adminAction(editor, jobId, "start"));
    const { packet, draft, audit } = responses(jobId, topic);
    const { cli, claudeCli, codexCli } = await fakeClis(
      { kind: "claude", responses: [{ structured: draft }] },
      { kind: "codex", responses: [{ message: packet }, { message: audit }] },
    );
    const { runner } = pipeline(5, cli);

    await driveTo(runner, jobId, "VERIFIED");

    const runs = await unwrap(
      editor.client
        .from("provider_runs")
        .select("stage, mode, provider, status, usage, cost_amount, prompt_snapshot")
        .eq("job_id", jobId)
        .order("created_at"),
    );
    expect(runs.map((run) => [run.stage, run.mode, run.provider, run.status])).toEqual([
      ["research", "codex_cli", "openai", "succeeded"],
      ["draft", "claude_code", "anthropic", "succeeded"],
      ["images", "mock", "gemini", "succeeded"],
      ["audit", "codex_cli", "openai", "succeeded"],
    ]);
    for (const run of runs.filter((entry) => entry.mode !== "mock")) {
      // Subscription runs record usage, never a billed cost.
      expect(run.usage).toMatchObject({ billing: "subscription" });
      expect(run.cost_amount).toBeNull();
    }

    // The artifacts are the normalized provider output, stored exactly as mock output would be.
    const [drafts, research, audits] = await Promise.all([
      unwrap(editor.client.from("drafts").select("title, slug, body_markdown").eq("job_id", jobId)),
      unwrap(editor.client.from("research_packets").select("version").eq("job_id", jobId)),
      unwrap(editor.client.from("audits").select("verdict").eq("job_id", jobId)),
    ]);
    expect(drafts).toEqual([
      { title: draft.title, slug: draft.slug, body_markdown: draft.bodyMarkdown },
    ]);
    expect(research).toHaveLength(1);
    expect(audits).toEqual([{ verdict: audit.verdict }]);

    // Each CLI received exactly the prompt snapshotted on its run, and none of the worker's secrets.
    const [researchPrompt, auditPrompt] = await codexCli.promptRuns();
    const [draftPrompt] = await claudeCli.promptRuns();
    expect(researchPrompt?.promptLength).toBe(runs[0]?.prompt_snapshot?.length);
    expect(draftPrompt?.promptLength).toBe(runs[1]?.prompt_snapshot?.length);
    expect(auditPrompt?.promptLength).toBe(runs[3]?.prompt_snapshot?.length);
    for (const invocation of [
      ...(await claudeCli.invocations()),
      ...(await codexCli.invocations()),
    ]) {
      expect(invocation.envKeys).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
  });

  it("sends a signed-out Claude Code to an editor before any prompt, with no fallback", async () => {
    const topic = "Signed-out writing CLI";
    const jobId = await createJob(editor, {
      topic,
      researchMode: "codex_cli",
      writingMode: "claude_code",
    });
    await unwrap(adminAction(editor, jobId, "start"));
    const { packet, draft } = responses(jobId, topic);
    const { cli, claudeCli } = await fakeClis(
      {
        kind: "claude",
        auth: { loggedIn: false, authMethod: "none", apiProvider: "firstParty" },
        responses: [{ structured: draft }],
      },
      { kind: "codex", responses: [{ message: packet }] },
    );
    const { runner } = pipeline(5, cli);

    await expect(runner.runOnce()).resolves.toMatchObject({ state: "completed" });
    await expect(runner.runOnce()).resolves.toMatchObject({ state: "needs_human" });

    const job = await jobRow(jobId);
    expect(job).toMatchObject({
      status: "NEEDS_HUMAN",
      needs_human_stage: "draft",
      action_required_kind: "cli_auth",
      writing_mode: "claude_code",
      lease_token: null,
    });
    expect(job.action_required_message).toMatch(/claude auth login/);
    const runs = await unwrap(
      editor.client
        .from("provider_runs")
        .select("stage, mode, status, error_class, retryable")
        .eq("job_id", jobId)
        .eq("stage", "draft"),
    );
    expect(runs).toEqual([
      {
        stage: "draft",
        mode: "claude_code",
        status: "failed",
        error_class: "auth",
        retryable: false,
      },
    ]);
    expect(await unwrap(editor.client.from("drafts").select("id").eq("job_id", jobId))).toEqual([]);
    expect(await claudeCli.promptRuns()).toHaveLength(0);
  });

  it("holds a Codex usage limit for an editor instead of retrying or switching provider", async () => {
    const jobId = await createJob(editor, {
      topic: "Usage-limited research CLI",
      researchMode: "codex_cli",
    });
    await unwrap(adminAction(editor, jobId, "start"));
    const { cli, codexCli } = await fakeClis(
      { kind: "claude", responses: [] },
      {
        kind: "codex",
        responses: [{ fail: "You have hit your usage limit. Try again at 2:00 PM." }],
      },
    );
    const { runner } = pipeline(5, cli);

    await expect(runner.runOnce()).resolves.toMatchObject({ state: "needs_human" });
    const job = await jobRow(jobId);
    expect(job).toMatchObject({
      status: "NEEDS_HUMAN",
      needs_human_stage: "research",
      action_required_kind: "usage_limit",
      research_mode: "codex_cli",
      next_attempt_at: null,
    });
    expect(job.action_required_message).toMatch(/no API was used/);
    expect(await codexCli.promptRuns()).toHaveLength(1);
    await expect(runner.runOnce()).resolves.toMatchObject({ state: "idle" });
  });

  it("escalates CLI output that fails the artifact schema as invalid output", async () => {
    const topic = "Malformed CLI draft";
    const jobId = await createJob(editor, { topic, writingMode: "claude_code" });
    await unwrap(adminAction(editor, jobId, "start"));
    const { draft } = responses(jobId, topic);
    const { cli } = await fakeClis(
      { kind: "claude", responses: [{ structured: { ...draft, slug: "Not A Slug" } }] },
      { kind: "codex", responses: [] },
    );
    const { runner } = pipeline(5, cli);

    await driveTo(runner, jobId, "NEEDS_HUMAN");
    const job = await jobRow(jobId);
    expect(job).toMatchObject({
      needs_human_stage: "draft",
      action_required_kind: "invalid_output",
    });
    expect(job.action_required_message).toMatch(/does not match draft-1/);
  });
});

describe("prompt versions", () => {
  it("seeds all six templates and supports immutable edit, activation, and rollback", async () => {
    const seedKeys = ["editorial-style", "research", "draft", "image-brief", "audit", "revise"];
    const seeded = await unwrap(
      editor.client
        .from("prompt_templates")
        .select("key, is_active")
        .eq("version", 1)
        .in("key", seedKeys),
    );
    expect(new Set(seeded.filter((row) => row.is_active).map((row) => row.key))).toEqual(
      new Set(seedKeys),
    );

    const key = `integration-${randomUUID().slice(0, 8)}`;
    const first = await unwrap(
      editor.client.rpc("admin_create_prompt_version", {
        p_key: key,
        p_content: "Version one for {{topic}}",
        p_variables_schema: { type: "object", required: ["topic"] },
      }),
    );
    const second = await unwrap(
      editor.client.rpc("admin_create_prompt_version", {
        p_key: key,
        p_content: "Version two for {{topic}}",
        p_variables_schema: { type: "object", required: ["topic"] },
      }),
    );
    expect(first[0]).toMatchObject({ version: 1, is_active: true });
    expect(second[0]).toMatchObject({ version: 2, is_active: true });

    await unwrap(
      editor.client.rpc("admin_activate_prompt_template", {
        p_template_id: first[0]!.template_id,
      }),
    );
    const versions = await unwrap(
      editor.client
        .from("prompt_templates")
        .select("id, version, content, is_active")
        .eq("key", key)
        .order("version"),
    );
    expect(versions).toEqual([
      expect.objectContaining({ version: 1, is_active: true }),
      expect.objectContaining({ version: 2, is_active: false }),
    ]);

    const denied = await viewer.client.rpc("admin_create_prompt_version", {
      p_key: `${key}-viewer`,
      p_content: "Viewers cannot edit prompts",
    });
    expect(denied.error?.code).toBe("42501");
  });

  it("updates only implemented no-cost provider defaults and keeps revision aligned with writing", async () => {
    const changed = await unwrap(
      editor.client.rpc("admin_update_provider_setting", {
        p_stage: "draft",
        p_mode: "manual_claude",
      }),
    );
    expect(changed).toEqual([
      { updated_stage: "draft", updated_mode: "manual_claude" },
      { updated_stage: "revision", updated_mode: "manual_claude" },
    ]);

    // Phase 9: the subscription CLIs are selectable; API modes wait for Phase 10.
    const codex = await unwrap(
      editor.client.rpc("admin_update_provider_setting", {
        p_stage: "research",
        p_mode: "codex_cli",
      }),
    );
    expect(codex).toEqual([{ updated_stage: "research", updated_mode: "codex_cli" }]);
    const claude = await unwrap(
      editor.client.rpc("admin_update_provider_setting", {
        p_stage: "draft",
        p_mode: "claude_code",
      }),
    );
    expect(claude).toEqual([
      { updated_stage: "draft", updated_mode: "claude_code" },
      { updated_stage: "revision", updated_mode: "claude_code" },
    ]);
    for (const [stage, mode] of [
      ["research", "openai_api"],
      ["draft", "anthropic_api"],
      ["images", "gemini_api"],
      ["images", "codex_cli"],
    ] as const) {
      const unsupported = await editor.client.rpc("admin_update_provider_setting", {
        p_stage: stage,
        p_mode: mode,
      });
      expect(unsupported.error?.code).toBe("22023");
    }
    const denied = await viewer.client.rpc("admin_update_provider_setting", {
      p_stage: "research",
      p_mode: "manual_chatgpt",
    });
    expect(denied.error?.code).toBe("42501");
    const restored = await serviceClient()
      .from("provider_settings")
      .update({ mode: "manual_chatgpt" })
      .eq("stage", "research");
    expect(restored.error).toBeNull();
  });
});
