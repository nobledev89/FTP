import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { adminUser, anonClient, closeDb, db, resetWorkflowData } from "./helpers/clients";
import type { TestUser } from "./helpers/clients";
import {
  adminAction,
  claim,
  claimFor,
  createJob,
  events,
  expectCode,
  expireLease,
  jobRow,
  runToApproved,
  unwrap,
  WORKER_A,
} from "./helpers/workflow";

/**
 * Discarding: the editor's way to turn down an article before it is published. DISCARDED is
 * terminal, keeps every artifact, and is refused while a stage is running under a live lease.
 */

let editor: TestUser;

beforeAll(async () => {
  editor = await adminUser("editor");
});

beforeEach(resetWorkflowData);

afterAll(closeDb);

async function discard(jobId: string, reason = "Not the angle we want", admin = editor) {
  const job = await jobRow(jobId);
  return admin.client.rpc("admin_discard_job", {
    p_job_id: jobId,
    p_expected_lock_version: job.lock_version,
    p_reason: reason,
  });
}

describe("admin_discard_job", () => {
  it("turns down an approved article for good and records why", async () => {
    const { jobId } = await runToApproved(editor, { slug: "discarded-approved" });

    const [result] = await unwrap(discard(jobId));
    expect(result).toMatchObject({ status: "DISCARDED" });

    const job = await jobRow(jobId);
    expect(job).toMatchObject({
      status: "DISCARDED",
      lease_token: null,
      next_attempt_at: null,
      action_required_kind: null,
      article_id: null,
    });
    expect((await events(jobId)).at(-1)).toMatchObject({
      event_type: "job.discarded",
      from_status: "APPROVED",
      to_status: "DISCARDED",
    });
    const { rows } = await db().query(
      "select note, actor_id from public.job_events where job_id = $1 and event_type = 'job.discarded'",
      [jobId],
    );
    expect(rows).toEqual([{ note: "Not the angle we want", actor_id: editor.id }]);

    // Terminal: nothing claims it, and no admin action moves it on.
    expect(await claim(WORKER_A)).toBeNull();
    expectCode((await adminAction(editor, jobId, "schedule")).error, "FT001");
    expectCode((await discard(jobId)).error, "FT001");
  });

  it("waits for a running stage, then clears the expired lease it left behind", async () => {
    const jobId = await createJob(editor);
    await unwrap(adminAction(editor, jobId, "start"));
    await claimFor(jobId);

    expectCode((await discard(jobId)).error, "FT003");
    await expireLease(jobId);
    await unwrap(discard(jobId));
    expect((await jobRow(jobId)).lease_token).toBeNull();
  });

  it("discards paused, pending, and escalated jobs", async () => {
    const paused = await createJob(editor);
    await unwrap(adminAction(editor, paused, "pause"));
    await unwrap(discard(paused));

    const pending = await createJob(editor);
    await unwrap(adminAction(editor, pending, "start"));
    await unwrap(discard(pending));

    const escalated = await createJob(editor);
    await unwrap(adminAction(editor, escalated, "mark_needs_human", { note: "Check the brief" }));
    await unwrap(discard(escalated));

    for (const jobId of [paused, pending, escalated]) {
      expect((await jobRow(jobId)).status).toBe("DISCARDED");
    }
  });

  it("refuses viewers, anonymous callers, stale pages, and blank reasons", async () => {
    const jobId = await createJob(editor);
    const viewer = await adminUser("viewer");
    const job = await jobRow(jobId);

    expectCode((await discard(jobId, "Viewer attempt", viewer)).error, "42501");
    expectCode(
      (
        await anonClient().rpc("admin_discard_job", {
          p_job_id: jobId,
          p_expected_lock_version: job.lock_version,
          p_reason: "Anonymous attempt",
        })
      ).error,
      "42501",
    );
    expectCode(
      (
        await editor.client.rpc("admin_discard_job", {
          p_job_id: jobId,
          p_expected_lock_version: job.lock_version + 1,
          p_reason: "Stale page",
        })
      ).error,
      "FT002",
    );
    expectCode((await discard(jobId, " ")).error, "22023");
    expect((await jobRow(jobId)).status).toBe("IDEA");
  });
});
