import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  adminUser,
  anonClient,
  closeDb,
  db,
  resetWorkflowData,
  serviceClient,
  type TestUser,
} from "./helpers/clients";
import {
  adminAction,
  audit,
  claim,
  claimFor,
  complete,
  createJob,
  draft,
  events,
  expectCode,
  jobRow,
  readyImage,
  researchPacket,
  runToApproved,
  succeed,
  unwrap,
  WORKER_A,
} from "./helpers/workflow";

let editor: TestUser;

beforeAll(async () => {
  editor = await adminUser("editor");
});

beforeEach(resetWorkflowData);

afterAll(closeDb);

const allChecks = [
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
  return allChecks.map((name) => ({
    name,
    outcome: overrides[name] ?? "succeeded",
    http_status: 200,
  }));
}

describe("state machine guard", () => {
  it("rejects direct status, lease, and history edits, even with the service role", async () => {
    const jobId = await createJob(editor);
    const service = serviceClient();

    expectCode(
      (await service.from("article_jobs").update({ status: "RESEARCH_PENDING" }).eq("id", jobId))
        .error,
      "FT001",
    );
    expectCode(
      (
        await service
          .from("article_jobs")
          .update({ lease_owner: WORKER_A, lease_token: crypto.randomUUID() })
          .eq("id", jobId)
      ).error,
      "FT001",
    );
    expectCode((await service.from("article_jobs").delete().eq("id", jobId)).error, "FT004");

    const forged = await service.from("article_jobs").insert({
      site_id: (await jobRow(jobId)).site_id,
      topic: "Forged published job",
      status: "PUBLISHED",
      research_mode: "mock",
      writing_mode: "mock",
      images_mode: "mock",
      audit_mode: "mock",
    });
    expectCode(forged.error, "FT001");

    const events = await service
      .from("job_events")
      .update({ note: "rewritten" })
      .eq("job_id", jobId);
    expectCode(events.error, "FT004");
  });

  it("lets non-workflow brief fields change without breaking optimistic locking", async () => {
    const jobId = await createJob(editor);
    const before = await jobRow(jobId);
    await succeed(
      serviceClient()
        .from("article_jobs")
        .update({ requirements: "Cite FCA sources" })
        .eq("id", jobId),
    );
    expect((await jobRow(jobId)).lock_version).toBe(before.lock_version + 1);
  });

  it("enforces stage gates and the allowed completion targets", async () => {
    const jobId = await createJob(editor);
    await unwrap(adminAction(editor, jobId, "start"));
    const claimed = (await claim())!;

    expectCode((await complete(claimed, "RESEARCH_COMPLETE")).error, "FT005");
    await researchPacket(jobId, 1, false);
    expectCode((await complete(claimed, "RESEARCH_COMPLETE")).error, "FT005");
    expectCode((await complete(claimed, "DRAFT_COMPLETE")).error, "FT001");

    await researchPacket(jobId, 2, true);
    await unwrap(complete(claimed, "RESEARCH_COMPLETE"));
    expect(await events(jobId)).toEqual([
      { event_type: "job.created", from_status: null, to_status: "IDEA" },
      { event_type: "job.started", from_status: "IDEA", to_status: "RESEARCH_PENDING" },
      { event_type: "stage.claimed", from_status: "RESEARCH_PENDING", to_status: "RESEARCHING" },
      { event_type: "stage.completed", from_status: "RESEARCHING", to_status: "RESEARCH_COMPLETE" },
      {
        event_type: "status.advanced",
        from_status: "RESEARCH_COMPLETE",
        to_status: "DRAFT_PENDING",
      },
    ]);
  });

  it("skips images only when none were requested, and records why", async () => {
    const { jobId } = await runToApproved(editor, { imageCount: 0 });
    const skipped = await db().query(
      "select metadata from public.job_events where job_id = $1 and to_status = 'AUDIT_PENDING'",
      [jobId],
    );
    expect(skipped.rows[0].metadata).toMatchObject({ images_skipped: true });
  });

  it("requires every requested image to be ready before audit", async () => {
    const jobId = await createJob(editor, { imageCount: 2 });
    await unwrap(adminAction(editor, jobId, "start"));
    let claimed = await claimFor(jobId);
    const { packetId } = await researchPacket(jobId);
    await unwrap(complete(claimed, "RESEARCH_COMPLETE"));
    claimed = await claimFor(jobId);
    await draft(jobId, packetId);
    await unwrap(complete(claimed, "DRAFT_COMPLETE"));
    expect((await jobRow(jobId)).status).toBe("IMAGES_PENDING");

    claimed = await claimFor(jobId);
    await readyImage(jobId, 0);
    expectCode((await complete(claimed, "AUDIT_PENDING")).error, "FT005");
    await readyImage(jobId, 1);
    await unwrap(complete(claimed, "AUDIT_PENDING"));
  });
});

describe("audit and revision loop", () => {
  it("allows two automatic revision cycles, then requires a human", async () => {
    const jobId = await createJob(editor);
    await unwrap(adminAction(editor, jobId, "start"));
    let claimed = await claimFor(jobId);
    const { packetId } = await researchPacket(jobId);
    await unwrap(complete(claimed, "RESEARCH_COMPLETE"));
    claimed = await claimFor(jobId);
    let draftId = await draft(jobId, packetId);
    await unwrap(complete(claimed, "DRAFT_COMPLETE"));

    for (let cycle = 0; cycle < 2; cycle += 1) {
      claimed = await claimFor(jobId);
      expect(claimed.stage).toBe("audit");
      const auditId = await audit(jobId, draftId, "REVISION_REQUIRED", {
        version: cycle + 1,
        cycle,
      });
      await unwrap(complete(claimed, "REVISION_REQUIRED"));

      claimed = await claimFor(jobId);
      expect(claimed).toMatchObject({ stage: "revision", status: "REVISING" });
      expectCode((await complete(claimed, "RE_AUDIT_PENDING")).error, "FT005");
      draftId = await draft(jobId, packetId, {
        version: cycle + 2,
        respondsToAuditId: auditId,
        stage: "revision",
      });
      await unwrap(complete(claimed, "RE_AUDIT_PENDING"));
      expect((await jobRow(jobId)).revision_count).toBe(cycle + 1);
    }

    claimed = await claimFor(jobId);
    await audit(jobId, draftId, "REVISION_REQUIRED", { version: 3, cycle: 2 });
    expectCode((await complete(claimed, "REVISION_REQUIRED")).error, "FT005");
    expectCode((await complete(claimed, "NEEDS_HUMAN")).error, "22023");
    await unwrap(
      complete(
        claimed,
        "NEEDS_HUMAN",
        WORKER_A,
        "Revision limit reached with unresolved factual findings",
      ),
    );

    expect(await jobRow(jobId)).toMatchObject({
      status: "NEEDS_HUMAN",
      needs_human_stage: "audit",
      action_required_kind: "editorial_review",
    });

    // A human may approve the latest audited draft, with a recorded reason.
    expectCode((await adminAction(editor, jobId, "resolve", { to: "APPROVED" })).error, "22023");
    expectCode(
      (await adminAction(editor, jobId, "resolve", { to: "REVISION_REQUIRED", note: "Try again" }))
        .error,
      "FT005",
    );
    await unwrap(
      adminAction(editor, jobId, "resolve", {
        to: "APPROVED",
        note: "Findings checked and accepted by editor",
      }),
    );
    expect(await jobRow(jobId)).toMatchObject({ status: "APPROVED", approved_draft_id: draftId });
  });

  it("does not let an escalation at research skip ahead", async () => {
    const jobId = await createJob(editor);
    await unwrap(adminAction(editor, jobId, "start"));
    await unwrap(
      adminAction(editor, jobId, "mark_needs_human", { note: "Topic needs legal review" }),
    );
    expectCode(
      (await adminAction(editor, jobId, "resolve", { to: "AUDIT_PENDING", note: "Skip" })).error,
      "FT005",
    );
    await unwrap(
      adminAction(editor, jobId, "resolve", {
        to: "RESEARCH_PENDING",
        note: "Legal approved the topic",
      }),
    );
    expect((await jobRow(jobId)).status).toBe("RESEARCH_PENDING");
  });
});

describe("publication boundary", () => {
  it("publishes exactly once, only through publish_article, and verifies only after every check passes", async () => {
    const { jobId, imageIds, sourceIds } = await runToApproved(editor, {
      imageCount: 1,
      autoPublish: true,
      slug: "pay-by-bank-checkout",
    });
    expect((await jobRow(jobId)).status).toBe("APPROVED");

    const publishing = await claimFor(jobId);
    expect(publishing).toMatchObject({ stage: "publish", status: "PUBLISHING", mode: "internal" });

    // No other path reaches PUBLISHED.
    expectCode((await complete(publishing, "PUBLISHED")).error, "FT001");
    expectCode(
      (await serviceClient().from("article_jobs").update({ status: "PUBLISHED" }).eq("id", jobId))
        .error,
      "FT001",
    );
    const forgedArticle = await serviceClient()
      .from("articles")
      .insert({
        site_id: (await jobRow(jobId)).site_id,
        slug: "forged",
        title: "Forged",
        excerpt: "Forged",
        body_markdown: "Forged",
        meta_title: "Forged",
        meta_description: "Forged",
        article_type: "news",
        byline_name: "Nobody",
        canonical_url: "https://fintechpulse.co.uk/blog/forged",
        status: "published",
        published_at: new Date().toISOString(),
      });
    expectCode(forgedArticle.error, "FT001");

    // Images must be copied to public storage first.
    const unpublishedImages = await serviceClient().rpc("publish_article", {
      p_job_id: jobId,
      p_worker_id: WORKER_A,
      p_lease_token: publishing.lease_token,
    });
    expectCode(unpublishedImages.error, "FT005");

    const [published] = await unwrap(
      serviceClient().rpc("publish_article", {
        p_job_id: jobId,
        p_worker_id: WORKER_A,
        p_lease_token: publishing.lease_token,
        p_published_images: [
          { image_id: imageIds[0], public_path: "articles/pay-by-bank-checkout/hero.png" },
        ],
      }),
    );
    expect(published).toMatchObject({
      slug: "pay-by-bank-checkout",
      canonical_url: "https://fintechpulse.co.uk/blog/pay-by-bank-checkout",
    });

    // Re-running with the stale lease cannot publish twice.
    const again = await serviceClient().rpc("publish_article", {
      p_job_id: jobId,
      p_worker_id: WORKER_A,
      p_lease_token: publishing.lease_token,
    });
    expectCode(again.error, "FT001");

    const job = await jobRow(jobId);
    expect(job).toMatchObject({
      status: "PUBLISHED",
      article_id: published!.article_id,
      lease_token: null,
    });

    // Public readers see the snapshot, with private sources excluded.
    const { data: article } = await anonClient()
      .from("articles")
      .select("slug, status, hero_image, source_references")
      .eq("slug", "pay-by-bank-checkout")
      .single();
    expect(article?.status).toBe("published");
    expect(article?.hero_image).toMatchObject({
      path: "articles/pay-by-bank-checkout/hero.png",
      alt: "Illustration of a card terminal",
    });
    expect(article?.source_references).toEqual([
      expect.objectContaining({
        title: "Financial Conduct Authority",
        url: "https://www.fca.org.uk/",
      }),
    ]);
    expect(sourceIds).toHaveLength(2);

    // A failed live check keeps the job PUBLISHED and schedules another attempt.
    let verifying = await claimFor(jobId);
    expect(verifying).toMatchObject({ stage: "verify", status: "PUBLISHED" });
    const afterFailure = await unwrap(
      serviceClient().rpc("record_verification", {
        p_job_id: jobId,
        p_worker_id: WORKER_A,
        p_lease_token: verifying.lease_token,
        p_checks: checks({ json_ld_valid: "failed" }),
        p_retry_at: new Date().toISOString(),
      }),
    );
    expect(afterFailure).toBe("PUBLISHED");
    expect((await jobRow(jobId)).next_attempt_at).not.toBeNull();

    // Skipping the hero check is not allowed when an image was requested.
    verifying = await claimFor(jobId);
    const skippedHero = await unwrap(
      serviceClient().rpc("record_verification", {
        p_job_id: jobId,
        p_worker_id: WORKER_A,
        p_lease_token: verifying.lease_token,
        p_checks: checks({ hero_image_ok: "skipped" }),
        p_retry_at: new Date().toISOString(),
      }),
    );
    expect(skippedHero).toBe("PUBLISHED");

    verifying = await claimFor(jobId);
    const verified = await unwrap(
      serviceClient().rpc("record_verification", {
        p_job_id: jobId,
        p_worker_id: WORKER_A,
        p_lease_token: verifying.lease_token,
        p_checks: checks(),
      }),
    );
    expect(verified).toBe("VERIFIED");

    const { data: verifiedArticle } = await anonClient()
      .from("articles")
      .select("status, verified_at")
      .eq("slug", "pay-by-bank-checkout")
      .single();
    expect(verifiedArticle?.status).toBe("verified");
    expect(await claim()).toBeNull();

    const logs = await db().query(
      "select kind::text, count(*)::int as count from public.publishing_logs where job_id = $1 group by kind order by kind",
      [jobId],
    );
    expect(logs.rows).toEqual([
      { kind: "publish", count: 1 },
      { kind: "verify_check", count: 24 },
      { kind: "verify_summary", count: 3 },
    ]);
  });

  it("rejects a second article with the same slug", async () => {
    for (const [index, expected] of [
      [0, null],
      [1, "FT006"],
    ] as const) {
      const { jobId } = await runToApproved(editor, {
        autoPublish: true,
        slug: "duplicate-slug",
        topic: `Duplicate ${index}`,
      });
      const publishing = await claimFor(jobId);
      const result = await serviceClient().rpc("publish_article", {
        p_job_id: jobId,
        p_worker_id: WORKER_A,
        p_lease_token: publishing.lease_token,
      });
      if (expected) {
        expectCode(result.error, expected);
      } else {
        expect(result.error).toBeNull();
        // Finish verification so this job no longer competes for claims.
        const verifying = await claimFor(jobId);
        await unwrap(
          serviceClient().rpc("record_verification", {
            p_job_id: jobId,
            p_worker_id: WORKER_A,
            p_lease_token: verifying.lease_token,
            p_checks: checks({ hero_image_ok: "skipped" }),
          }),
        );
      }
    }
  });

  it("waits for the scheduled time before publishing", async () => {
    const { jobId } = await runToApproved(editor, { autoPublish: false });
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await unwrap(adminAction(editor, jobId, "schedule", { desiredPublishAt: future }));
    expect(await jobRow(jobId)).toMatchObject({ status: "SCHEDULED" });
    expect(await claim()).toBeNull();

    await unwrap(adminAction(editor, jobId, "pause"));
    await unwrap(adminAction(editor, jobId, "resume"));
    expect((await jobRow(jobId)).status).toBe("SCHEDULED");
  });
});

describe("artifact immutability", () => {
  it("keeps drafts, audits, and runs immutable while allowing scoped review metadata", async () => {
    const { jobId, draftId } = await runToApproved(editor);
    const service = serviceClient();

    expectCode(
      (
        await service
          .from("drafts")
          .update({ body_markdown: "Rewritten history" })
          .eq("id", draftId)
      ).error,
      "FT004",
    );
    expectCode((await service.from("drafts").delete().eq("id", draftId)).error, "FT004");
    expectCode(
      (await service.from("audits").update({ summary: "Softened findings" }).eq("job_id", jobId))
        .error,
      "FT004",
    );
    expectCode(
      (
        await service
          .from("provider_runs")
          .update({ prompt_snapshot: "changed" })
          .eq("job_id", jobId)
      ).error,
      "FT004",
    );

    const review = await service
      .from("drafts")
      .update({
        review_note: "Checked by the editor",
        reviewed_by: editor.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", draftId);
    expect(review.error).toBeNull();
  });

  it("rejects artifacts that reference another job's research", async () => {
    const first = await createJob(editor);
    const second = await createJob(editor);
    const { packetId } = await researchPacket(first);
    await expect(draft(second, packetId)).rejects.toThrow(/23503/);
  });
});
