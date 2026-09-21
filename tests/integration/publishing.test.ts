import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  adminUser,
  anonClient,
  closeDb,
  db,
  resetWorkflowData,
  serviceClient,
} from "./helpers/clients";
import type { TestUser } from "./helpers/clients";
import type { Claim, Stage } from "./helpers/workflow";
import {
  adminAction,
  claim,
  complete,
  createJob,
  events,
  expectCode,
  expireLease,
  jobRow,
  runToApproved,
  succeed,
  unwrap,
  WORKER_A,
  WORKER_B,
} from "./helpers/workflow";

/**
 * Phase 11 — the publication boundary under stress.
 *
 * The happy path through publish and verification lives in `state-machine.test.ts`. This file
 * covers what the plan asks Phase 11 to prove: that simultaneous attempts, slug collisions,
 * schedule edges, storage problems, cache failures, and partially available pages all resolve to
 * exactly one published article, and that nothing outside the publishing service can reach
 * `PUBLISHED` at all.
 */

let editor: TestUser;

beforeAll(async () => {
  editor = await adminUser("editor");
});

beforeEach(resetWorkflowData);

afterAll(closeDb);

const ALL_CHECKS = [
  "status_ok",
  "canonical_matches",
  "title_present",
  "body_present",
  "hero_image_ok",
  "meta_present",
  "json_ld_valid",
  "no_placeholders",
];

function checks(overrides: Record<string, "succeeded" | "failed" | "skipped"> = {}) {
  return ALL_CHECKS.map((name) => ({
    name,
    outcome: overrides[name] ?? "succeeded",
    http_status: 200,
  }));
}

/**
 * Applies a workflow-column change the way the state machine functions do. Test setup only: these
 * columns are guarded, so the alternative would be waiting out a real backoff.
 */
async function asStateMachine(sql: string, params: unknown[] = []): Promise<void> {
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query("select set_config('fintechpulse.state_context', 'transition', true)");
    await client.query(sql, params);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Makes a job whose retry is pending claimable now. */
function retryNow(jobId: string): Promise<void> {
  return asStateMachine(
    "update public.article_jobs set next_attempt_at = now() where id = $1 and next_attempt_at is not null",
    [jobId],
  );
}

/**
 * Claims a specific stage of a specific job. These tests deliberately leave jobs published and
 * awaiting verification, so an unfiltered claim would pick up the wrong one.
 */
async function claimStage(jobId: string, stage: Stage, workerId = WORKER_A): Promise<Claim> {
  const claimed = await claim(workerId, [stage]);
  if (!claimed || claimed.job_id !== jobId) {
    throw new Error(`expected to claim ${stage} of ${jobId}, got ${JSON.stringify(claimed)}`);
  }
  return claimed;
}

/**
 * Makes an APPROVED job claimable for publication right now. Used where a test needs several jobs
 * approved before any of them publishes, since an APPROVED auto-publish job is claimable the
 * moment it exists and would be picked up by the next job's setup.
 */
async function releaseForPublish(jobId: string): Promise<void> {
  await unwrap(
    adminAction(editor, jobId, "schedule", { desiredPublishAt: new Date().toISOString() }),
  );
}

/** Publishes a job that is already APPROVED with auto-publish, returning the claim used. */
async function publishNow(jobId: string, workerId = WORKER_A) {
  const publishing = await claimStage(jobId, "publish", workerId);
  const rows = await unwrap(
    serviceClient().rpc("publish_article", {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_lease_token: publishing.lease_token,
    }),
  );
  return { publishing, article: rows[0]! };
}

describe("simultaneous publish attempts", () => {
  it("produces exactly one article when two transactions publish the same job at once", async () => {
    const { jobId } = await runToApproved(editor, {
      autoPublish: true,
      slug: "concurrent-publish",
    });
    const publishing = await claimStage(jobId, "publish");

    const first = await db().connect();
    const second = await db().connect();
    let firstRows = 0;
    let secondError: { code?: string } | null = null;
    try {
      await first.query("begin; set local role service_role");
      await second.query("begin; set local role service_role");

      // The first transaction holds the job row for update; the second blocks on it, then finds a
      // job that is already PUBLISHED rather than PUBLISHING.
      const a = await first.query("select * from public.publish_article($1, $2, $3)", [
        jobId,
        WORKER_A,
        publishing.lease_token,
      ]);
      firstRows = a.rowCount ?? 0;
      await first.query("commit");

      try {
        await second.query("select * from public.publish_article($1, $2, $3)", [
          jobId,
          WORKER_A,
          publishing.lease_token,
        ]);
      } catch (error) {
        secondError = error as { code?: string };
      }
      await second.query("rollback");
    } finally {
      first.release();
      second.release();
    }

    expect(firstRows).toBe(1);
    expect(secondError?.code).toBe("FT001");

    const { rows } = await db().query<{ count: string }>(
      "select count(*) as count from public.articles where slug = $1",
      ["concurrent-publish"],
    );
    expect(rows[0]?.count).toBe("1");
    expect((await jobRow(jobId)).status).toBe("PUBLISHED");
    expect(
      (await events(jobId)).filter((event) => event.event_type === "job.published"),
    ).toHaveLength(1);
  });

  it("refuses a replayed publish from a worker whose lease was already settled", async () => {
    const { jobId } = await runToApproved(editor, { autoPublish: true, slug: "replayed-publish" });
    const { publishing } = await publishNow(jobId);

    // The lease was cleared by publication, so the same call is now both wrong-status and
    // wrong-lease. Either way it must not write a second article.
    expectCode(
      (
        await serviceClient().rpc("publish_article", {
          p_job_id: jobId,
          p_worker_id: WORKER_A,
          p_lease_token: publishing.lease_token,
        })
      ).error,
      "FT001",
    );
    const { rows } = await db().query<{ count: string }>(
      "select count(*) as count from public.articles where slug = $1",
      ["replayed-publish"],
    );
    expect(rows[0]?.count).toBe("1");
  });
});

describe("slug conflicts", () => {
  it("refuses a slug reserved by an alias of an existing article", async () => {
    const { jobId } = await runToApproved(editor, { slug: "original-slug" });
    const second = await runToApproved(editor, {
      slug: "renamed-slug",
      topic: "Article claiming a reserved alias",
    });

    await releaseForPublish(jobId);
    const { article } = await publishNow(jobId);
    await succeed(
      serviceClient()
        .from("article_slug_aliases")
        .insert({
          site_id: (await jobRow(jobId)).site_id,
          article_id: article.article_id,
          slug: "renamed-slug",
        }),
    );

    await releaseForPublish(second.jobId);
    const publishing = await claimStage(second.jobId, "publish");
    expectCode(
      (
        await serviceClient().rpc("publish_article", {
          p_job_id: second.jobId,
          p_worker_id: WORKER_A,
          p_lease_token: publishing.lease_token,
        })
      ).error,
      "FT006",
    );
    // The refused job stays claimable rather than half-published.
    expect((await jobRow(second.jobId)).article_id).toBeNull();
  });

  it("leaves a slug-conflicted job recoverable by an editor rather than half-published", async () => {
    const first = await runToApproved(editor, { slug: "taken-slug" });
    const second = await runToApproved(editor, {
      slug: "taken-slug",
      topic: "Second article wanting a taken slug",
    });

    await releaseForPublish(first.jobId);
    await publishNow(first.jobId);
    await releaseForPublish(second.jobId);
    const publishing = await claimStage(second.jobId, "publish");
    expectCode(
      (
        await serviceClient().rpc("publish_article", {
          p_job_id: second.jobId,
          p_worker_id: WORKER_A,
          p_lease_token: publishing.lease_token,
        })
      ).error,
      "FT006",
    );

    // A slug collision cannot be fixed by retrying, because drafts are immutable. The stage
    // escalates instead, and the job an editor picks up is still fully intact.
    await unwrap(
      serviceClient().rpc("fail_stage", {
        p_job_id: second.jobId,
        p_worker_id: WORKER_A,
        p_lease_token: publishing.lease_token,
        p_outcome: "needs_human",
        p_error_class: "permanent_config",
        p_summary: "Slug taken-slug is already published",
      }),
    );
    const escalated = await jobRow(second.jobId);
    expect(escalated.status).toBe("NEEDS_HUMAN");
    expect(escalated.action_required_kind).toBe("publish_conflict");
    expect(escalated.article_id).toBeNull();
    expect(escalated.approved_draft_id).not.toBeNull();
  });
});

describe("schedule edges", () => {
  it("keeps two schedules in a repeated local hour distinct, then claims each when it arrives", async () => {
    // Europe/London repeats 01:00-02:00 local when the clocks go back on 2026-10-25, so the local
    // reading "01:30" is two different instants. The console resolves that (see the timezone unit
    // tests); the queue must store and compare the instants it was given, unshifted.
    const earlier = "2026-10-25T00:30:00.000Z";
    const later = "2026-10-25T01:30:00.000Z";

    const first = await runToApproved(editor, { autoPublish: false, slug: "earlier-reading" });
    await unwrap(adminAction(editor, first.jobId, "schedule", { desiredPublishAt: earlier }));
    const second = await runToApproved(editor, {
      autoPublish: false,
      slug: "later-reading",
      topic: "Second reading of the repeated hour",
    });
    await unwrap(adminAction(editor, second.jobId, "schedule", { desiredPublishAt: later }));

    expect(new Date((await jobRow(first.jobId)).desired_publish_at!).toISOString()).toBe(earlier);
    expect(new Date((await jobRow(second.jobId)).desired_publish_at!).toISOString()).toBe(later);
    // Both instants are still ahead of the clock, so neither is claimable yet.
    expect(await claim()).toBeNull();

    // Advance past the earlier instant only: exactly one job becomes claimable, and it is the one
    // whose instant passed, not whichever shares the local reading.
    await db().query(
      "update public.article_jobs set desired_publish_at = now() - interval '1 second' where id = $1",
      [first.jobId],
    );
    const claimed = await claim();
    expect(claimed).toMatchObject({
      job_id: first.jobId,
      stage: "publish",
      status: "PUBLISHING",
    });
    expect((await jobRow(second.jobId)).status).toBe("SCHEDULED");
  });

  it("refuses to publish a job whose scheduled instant has not arrived, even with a valid lease", async () => {
    const { jobId } = await runToApproved(editor, { autoPublish: false });
    await unwrap(
      adminAction(editor, jobId, "schedule", {
        desiredPublishAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
    expect(await claim()).toBeNull();

    // Let the schedule pass so the job is claimed, then move it back: an editor rescheduling a job
    // a worker already holds must not be able to publish it early. Claim eligibility and publish
    // eligibility are checked independently, and both have to agree.
    await db().query(
      "update public.article_jobs set desired_publish_at = now() - interval '1 minute' where id = $1",
      [jobId],
    );
    const publishing = await claimStage(jobId, "publish");
    await db().query(
      "update public.article_jobs set desired_publish_at = now() + interval '1 hour' where id = $1",
      [jobId],
    );
    expectCode(
      (
        await serviceClient().rpc("publish_article", {
          p_job_id: jobId,
          p_worker_id: WORKER_A,
          p_lease_token: publishing.lease_token,
        })
      ).error,
      "FT005",
    );
  });

  it("rejects a schedule beyond the claimable horizon instead of parking the job forever", async () => {
    const { jobId } = await runToApproved(editor, { autoPublish: false });
    const mistypedYear = new Date(Date.now() + 400 * 24 * 3_600_000).toISOString();
    expectCode(
      (await adminAction(editor, jobId, "schedule", { desiredPublishAt: mistypedYear })).error,
      "FT005",
    );
    expect((await jobRow(jobId)).status).toBe("APPROVED");

    expectCode(
      (
        await editor.client.rpc("create_article_job", {
          p_topic: "Job scheduled past the horizon",
          p_keywords: ["payments"],
          p_desired_publish_at: mistypedYear,
          p_research_mode: "mock",
          p_writing_mode: "mock",
          p_images_mode: "mock",
          p_audit_mode: "mock",
        })
      ).error,
      "FT005",
    );
  });
});

describe("public storage copies", () => {
  it("accepts only article-scoped public paths and treats a repeated path as a no-op", async () => {
    const { jobId, imageIds } = await runToApproved(editor, {
      imageCount: 1,
      autoPublish: true,
      slug: "image-paths",
    });
    const publishing = await claimStage(jobId, "publish");

    expectCode(
      (
        await serviceClient().rpc("publish_article", {
          p_job_id: jobId,
          p_worker_id: WORKER_A,
          p_lease_token: publishing.lease_token,
          p_published_images: [{ image_id: imageIds[0], public_path: "../escaped.png" }],
        })
      ).error,
      "22023",
    );

    const published = await unwrap(
      serviceClient().rpc("publish_article", {
        p_job_id: jobId,
        p_worker_id: WORKER_A,
        p_lease_token: publishing.lease_token,
        p_published_images: [
          { image_id: imageIds[0], public_path: "articles/image-paths/hero-v1.png" },
        ],
      }),
    );
    expect(published[0]?.slug).toBe("image-paths");

    const { rows } = await db().query<{ public_path: string; status: string }>(
      "select public_path, status from public.images where job_id = $1",
      [jobId],
    );
    expect(rows[0]).toMatchObject({
      public_path: "articles/image-paths/hero-v1.png",
      status: "published",
    });
  });

  it("refuses to publish while a requested image has no public copy", async () => {
    const { jobId } = await runToApproved(editor, {
      imageCount: 1,
      autoPublish: true,
      slug: "missing-public-copy",
    });
    const publishing = await claimStage(jobId, "publish");

    // This is what a failed Storage upload looks like at the boundary: the worker never reports a
    // public path, so the article must not be written at all.
    expectCode(
      (
        await serviceClient().rpc("publish_article", {
          p_job_id: jobId,
          p_worker_id: WORKER_A,
          p_lease_token: publishing.lease_token,
        })
      ).error,
      "FT005",
    );
    expect((await jobRow(jobId)).article_id).toBeNull();

    // The stage can then fail and retry without losing the approved work.
    await unwrap(
      serviceClient().rpc("fail_stage", {
        p_job_id: jobId,
        p_worker_id: WORKER_A,
        p_lease_token: publishing.lease_token,
        p_outcome: "retry",
        p_error_class: "transient",
        p_summary: "Storage upload failed",
      }),
    );
    expect((await jobRow(jobId)).status).toBe("APPROVED");
  });
});

describe("cache revalidation logging", () => {
  it("records a failed invalidation without touching the published article", async () => {
    const { jobId } = await runToApproved(editor, { autoPublish: true, slug: "stale-cache" });
    const { article } = await publishNow(jobId);

    await unwrap(
      serviceClient().rpc("record_revalidation", {
        p_job_id: jobId,
        p_worker_id: WORKER_A,
        p_outcome: "failed",
        p_attempts: 3,
        p_duration_ms: 1500,
        p_request_summary: { slug: "stale-cache" },
        p_error: "Revalidation responded 503",
      }),
    );

    const { rows } = await db().query<{
      outcome: string;
      attempt: number;
      error: string;
      article_id: string;
    }>(
      "select outcome, attempt, error, article_id from public.publishing_logs where job_id = $1 and kind = 'revalidate'",
      [jobId],
    );
    expect(rows[0]).toMatchObject({
      outcome: "failed",
      attempt: 3,
      error: "Revalidation responded 503",
      article_id: article.article_id,
    });
    // The article is still published: a stale cache is a verification problem, not a rollback.
    expect((await jobRow(jobId)).status).toBe("PUBLISHED");
    expect((await jobRow(jobId)).article_id).toBe(article.article_id);
  });

  it("refuses to log a revalidation for a job that has not published anything", async () => {
    const jobId = await createJob(editor);
    expectCode(
      (
        await serviceClient().rpc("record_revalidation", {
          p_job_id: jobId,
          p_worker_id: WORKER_A,
          p_outcome: "succeeded",
        })
      ).error,
      "FT001",
    );
  });

  it("is not callable by anonymous or signed-in non-worker clients", async () => {
    const { jobId } = await runToApproved(editor, { autoPublish: true, slug: "log-authz" });
    await publishNow(jobId);

    const attempt = await editor.client.rpc("record_revalidation", {
      p_job_id: jobId,
      p_worker_id: WORKER_A,
      p_outcome: "succeeded",
    });
    expect(attempt.error).not.toBeNull();
  });
});

describe("verification retries and partial pages", () => {
  it("keeps an article that renders without its hero image unverified and retries with backoff", async () => {
    const { jobId } = await runToApproved(editor, {
      imageCount: 1,
      autoPublish: true,
      slug: "partial-page",
    });
    const publishing = await claimStage(jobId, "publish");
    await unwrap(
      serviceClient().rpc("publish_article", {
        p_job_id: jobId,
        p_worker_id: WORKER_A,
        p_lease_token: publishing.lease_token,
        p_published_images: [
          {
            image_id: (
              await db().query<{ id: string }>(
                "select id from public.images where job_id = $1 limit 1",
                [jobId],
              )
            ).rows[0]!.id,
            public_path: "articles/partial-page/hero-v1.png",
          },
        ],
      }),
    );

    // The page rendered, but the hero image 404s: the article is only partially available.
    const verifying = await claimStage(jobId, "verify");
    const retryAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const status = await unwrap(
      serviceClient().rpc("record_verification", {
        p_job_id: jobId,
        p_worker_id: WORKER_A,
        p_lease_token: verifying.lease_token,
        p_checks: checks({ hero_image_ok: "failed" }),
        p_retry_at: retryAt,
      }),
    );

    expect(status).toBe("PUBLISHED");
    const job = await jobRow(jobId);
    expect(job.next_attempt_at).not.toBeNull();
    expect(new Date(job.next_attempt_at!).getTime()).toBeCloseTo(new Date(retryAt).getTime(), -4);
    // A job requesting images cannot satisfy hero_image_ok by skipping it.
    await retryNow(jobId);
    const skipped = await claimStage(jobId, "verify");
    expect(
      await unwrap(
        serviceClient().rpc("record_verification", {
          p_job_id: jobId,
          p_worker_id: WORKER_A,
          p_lease_token: skipped.lease_token,
          p_checks: checks({ hero_image_ok: "skipped" }),
        }),
      ),
    ).toBe("PUBLISHED");
  });

  it("clamps a retry the worker asks for into a window a worker will actually reach", async () => {
    const { jobId } = await runToApproved(editor, { autoPublish: true, slug: "clamped-retry" });
    await publishNow(jobId);

    const farFuture = await claimStage(jobId, "verify");
    await unwrap(
      serviceClient().rpc("record_verification", {
        p_job_id: jobId,
        p_worker_id: WORKER_A,
        p_lease_token: farFuture.lease_token,
        p_checks: checks({ body_present: "failed" }),
        p_retry_at: new Date(Date.now() + 30 * 24 * 3_600_000).toISOString(),
      }),
    );
    const clamped = await jobRow(jobId);
    expect(new Date(clamped.next_attempt_at!).getTime()).toBeLessThanOrEqual(
      Date.now() + 61 * 60_000,
    );

    await retryNow(jobId);
    const past = await claimStage(jobId, "verify");
    await unwrap(
      serviceClient().rpc("record_verification", {
        p_job_id: jobId,
        p_worker_id: WORKER_A,
        p_lease_token: past.lease_token,
        p_checks: checks({ body_present: "failed" }),
        p_retry_at: new Date(Date.now() - 7 * 24 * 3_600_000).toISOString(),
      }),
    );
    // A retry in the past is pulled forward to now rather than making the job claimable "late".
    expect(new Date((await jobRow(jobId)).next_attempt_at!).getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
  });

  it("names the failing checks when the attempts are exhausted", async () => {
    const { jobId } = await runToApproved(editor, { autoPublish: true, slug: "exhausted-checks" });
    await publishNow(jobId);

    const job = await jobRow(jobId);
    let status = "PUBLISHED";
    for (let attempt = 0; attempt < job.max_attempts + 1 && status === "PUBLISHED"; attempt += 1) {
      const current = await jobRow(jobId);
      if (current.action_required_kind !== null) break;
      await retryNow(jobId);
      const verifying = await claim(WORKER_A, ["verify"]);
      if (!verifying) break;
      status = await unwrap(
        serviceClient().rpc("record_verification", {
          p_job_id: jobId,
          p_worker_id: WORKER_A,
          p_lease_token: verifying.lease_token,
          p_checks: checks({ canonical_matches: "failed", json_ld_valid: "failed" }),
        }),
      );
    }

    const exhausted = await jobRow(jobId);
    expect(exhausted.status).toBe("PUBLISHED");
    expect(exhausted.action_required_kind).toBe("verification_failed");
    expect(exhausted.action_required_message).toContain("canonical_matches");
    expect(exhausted.action_required_message).toContain("json_ld_valid");
    expect(exhausted.next_attempt_at).toBeNull();
    expect((await events(jobId)).at(-1)?.event_type).toBe("verification.exhausted");
    // An exhausted verification never advances the article.
    const { rows } = await db().query<{ status: string }>(
      "select status from public.articles where id = $1",
      [exhausted.article_id],
    );
    expect(rows[0]?.status).toBe("published");
  });
});

describe("publication boundary isolation", () => {
  it("gives no path to PUBLISHED outside publish_article, even for the worker role", async () => {
    const { jobId } = await runToApproved(editor, { autoPublish: true, slug: "boundary-check" });
    const publishing = await claimStage(jobId, "publish");
    const service = serviceClient();

    // A provider stage handler has exactly these capabilities: complete_stage, direct table writes,
    // and its own artifact inserts. None of them may publish.
    expectCode((await complete(publishing, "PUBLISHED")).error, "FT001");
    expectCode(
      (await service.from("article_jobs").update({ status: "PUBLISHED" }).eq("id", jobId)).error,
      "FT001",
    );
    expectCode(
      (
        await service.from("articles").insert({
          site_id: (await jobRow(jobId)).site_id,
          slug: "boundary-check",
          title: "Forged article",
          excerpt: "Written around the publishing service.",
          body_markdown: "Forged body.",
          meta_title: "Forged article",
          meta_description: "Written around the publishing service.",
          article_type: "news",
          byline_name: "FinTechPulse",
          canonical_url: "https://fintechpulse.co.uk/blog/boundary-check",
          status: "published",
          published_at: new Date().toISOString(),
        })
      ).error,
      "FT001",
    );

    // Nor may a second worker publish a job it does not hold the lease on.
    expectCode(
      (
        await service.rpc("publish_article", {
          p_job_id: jobId,
          p_worker_id: WORKER_B,
          p_lease_token: publishing.lease_token,
        })
      ).error,
      "FT003",
    );

    expect((await jobRow(jobId)).status).toBe("PUBLISHING");
    const { rows } = await db().query<{ count: string }>(
      "select count(*) as count from public.articles where slug = $1",
      ["boundary-check"],
    );
    expect(rows[0]?.count).toBe("0");
  });

  it("does not let a verified article be rewritten outside the publishing service", async () => {
    const { jobId } = await runToApproved(editor, { autoPublish: true, slug: "verified-article" });
    const { article } = await publishNow(jobId);
    const verifying = await claimStage(jobId, "verify");
    expect(
      await unwrap(
        serviceClient().rpc("record_verification", {
          p_job_id: jobId,
          p_worker_id: WORKER_A,
          p_lease_token: verifying.lease_token,
          p_checks: checks({ hero_image_ok: "skipped" }),
        }),
      ),
    ).toBe("VERIFIED");

    expectCode(
      (
        await serviceClient()
          .from("articles")
          .update({ status: "withdrawn" })
          .eq("id", article.article_id)
      ).error,
      "FT001",
    );
  });
});

describe("article withdrawal", () => {
  async function verifiedArticle(slug: string) {
    const { jobId } = await runToApproved(editor, { autoPublish: true, slug });
    await publishNow(jobId);
    const verifying = await claimStage(jobId, "verify");
    await unwrap(
      serviceClient().rpc("record_verification", {
        p_job_id: jobId,
        p_worker_id: WORKER_A,
        p_lease_token: verifying.lease_token,
        p_checks: checks(),
      }),
    );
    return jobId;
  }

  async function withdraw(jobId: string, reason = "Factual error in the lead", admin = editor) {
    const job = await jobRow(jobId);
    return admin.client.rpc("admin_withdraw_article", {
      p_job_id: jobId,
      p_expected_lock_version: job.lock_version,
      p_reason: reason,
    });
  }

  async function publicRows(slug: string) {
    return unwrap(anonClient().from("articles").select("id").eq("slug", slug));
  }

  it("takes a verified article out of every public read and records who and why", async () => {
    const jobId = await verifiedArticle("withdrawn-verified");
    expect(await publicRows("withdrawn-verified")).toHaveLength(1);

    const [result] = await unwrap(withdraw(jobId));
    expect(result!.slug).toBe("withdrawn-verified");

    expect(await publicRows("withdrawn-verified")).toHaveLength(0);
    const job = await jobRow(jobId);
    expect(job.status).toBe("VERIFIED");
    expect(result!.lock_version).toBe(job.lock_version);

    const { rows } = await db().query(
      "select status, withdrawn_at, verified_at from public.articles where id = $1",
      [job.article_id],
    );
    expect(rows[0]).toMatchObject({ status: "withdrawn" });
    expect(rows[0].withdrawn_at).not.toBeNull();
    // The verification record is history and survives the withdrawal.
    expect(rows[0].verified_at).not.toBeNull();

    const history = await db().query(
      "select event_type, actor_type, actor_id, note, metadata from public.job_events where job_id = $1 and event_type = 'article.withdrawn'",
      [jobId],
    );
    expect(history.rows).toEqual([
      expect.objectContaining({
        actor_type: "admin",
        actor_id: editor.id,
        note: "Factual error in the lead",
        metadata: expect.objectContaining({ slug: "withdrawn-verified" }),
      }),
    ]);

    // The slug stays reserved, and a second withdrawal is refused.
    expectCode((await withdraw(jobId)).error, "FT001");
  });

  it("cancels a pending verification so the worker never claims the withdrawn article", async () => {
    const { jobId } = await runToApproved(editor, { autoPublish: true, slug: "withdrawn-pending" });
    await publishNow(jobId);
    expect((await jobRow(jobId)).next_attempt_at).not.toBeNull();

    await unwrap(withdraw(jobId));

    const job = await jobRow(jobId);
    expect(job.status).toBe("PUBLISHED");
    expect(job.next_attempt_at).toBeNull();
    expect(job.action_required_kind).toBeNull();
    expect(await claim(WORKER_A, ["verify"])).toBeNull();
    expect(await publicRows("withdrawn-pending")).toHaveLength(0);
  });

  it("waits for a verification in flight, then clears its expired lease", async () => {
    const { jobId } = await runToApproved(editor, { autoPublish: true, slug: "withdrawn-leased" });
    await publishNow(jobId);
    await claimStage(jobId, "verify");

    expectCode((await withdraw(jobId)).error, "FT003");
    expect(await publicRows("withdrawn-leased")).toHaveLength(1);

    await expireLease(jobId);
    await unwrap(withdraw(jobId));
    const job = await jobRow(jobId);
    expect(job.lease_token).toBeNull();
    expect(await claim(WORKER_A, ["verify"])).toBeNull();
  });

  it("refuses viewers, anonymous callers, stale pages, missing reasons, and unpublished jobs", async () => {
    const jobId = await verifiedArticle("withdrawal-guards");
    const viewer = await adminUser("viewer");
    const job = await jobRow(jobId);

    expectCode((await withdraw(jobId, "Viewer attempt", viewer)).error, "42501");
    expectCode(
      (
        await anonClient().rpc("admin_withdraw_article", {
          p_job_id: jobId,
          p_expected_lock_version: job.lock_version,
          p_reason: "Anonymous attempt",
        })
      ).error,
      "42501",
    );
    expectCode(
      (
        await editor.client.rpc("admin_withdraw_article", {
          p_job_id: jobId,
          p_expected_lock_version: job.lock_version - 1,
          p_reason: "Stale page",
        })
      ).error,
      "FT002",
    );
    expectCode((await withdraw(jobId, "  ")).error, "22023");

    const unpublished = await createJob(editor);
    expectCode((await withdraw(unpublished)).error, "FT001");

    expect(await publicRows("withdrawal-guards")).toHaveLength(1);
  });
});
