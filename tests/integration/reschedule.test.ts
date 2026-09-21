import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { adminUser, closeDb, resetWorkflowData } from "./helpers/clients";
import type { TestUser } from "./helpers/clients";
import {
  adminAction,
  claim,
  events,
  expectCode,
  jobRow,
  runToApproved,
  unwrap,
} from "./helpers/workflow";

/**
 * `admin_reschedule_job`: moving a scheduled article's publication time, including to now, which
 * is what the console's "Publish now" does. The status stays SCHEDULED, so the transition map is
 * untouched and only the queue's own eligibility rules decide when the worker may claim it.
 */

let editor: TestUser;
let viewer: TestUser;

beforeAll(async () => {
  editor = await adminUser("editor");
  viewer = await adminUser("viewer");
});

beforeEach(resetWorkflowData);

afterAll(closeDb);

const HOUR = 3_600_000;

async function scheduledJob(offsetMs: number, slug: string): Promise<string> {
  const { jobId } = await runToApproved(editor, { slug });
  await unwrap(
    adminAction(editor, jobId, "schedule", {
      desiredPublishAt: new Date(Date.now() + offsetMs).toISOString(),
    }),
  );
  return jobId;
}

async function reschedule(jobId: string, at: Date | null, admin = editor, lockVersion?: number) {
  const job = await jobRow(jobId);
  return admin.client.rpc("admin_reschedule_job", {
    p_job_id: jobId,
    p_expected_lock_version: lockVersion ?? job.lock_version,
    ...(at ? { p_desired_publish_at: at.toISOString() } : {}),
  });
}

describe("admin_reschedule_job", () => {
  it("publishes now when no time is given, and the worker can then claim it", async () => {
    const jobId = await scheduledJob(24 * HOUR, "reschedule-now");
    expect(await claim()).toBeNull();

    const [result] = await unwrap(reschedule(jobId, null));
    expect(Date.parse(result!.desired_publish_at)).toBeLessThanOrEqual(Date.now());

    const job = await jobRow(jobId);
    expect(job.status).toBe("SCHEDULED");
    expect((await events(jobId)).at(-1)).toMatchObject({
      event_type: "job.rescheduled",
      from_status: "SCHEDULED",
      to_status: "SCHEDULED",
    });
    expect(await claim()).toMatchObject({ job_id: jobId, stage: "publish", status: "PUBLISHING" });
  });

  it("moves the time without making the article claimable early", async () => {
    const jobId = await scheduledJob(24 * HOUR, "reschedule-later");
    const moved = new Date(Date.now() + 2 * HOUR);

    const [result] = await unwrap(reschedule(jobId, moved));
    expect(new Date(result!.desired_publish_at).toISOString()).toBe(moved.toISOString());
    expect((await jobRow(jobId)).status).toBe("SCHEDULED");
    expect(await claim()).toBeNull();
  });

  it("refuses a stale lock version rather than overwriting a newer decision", async () => {
    const jobId = await scheduledJob(24 * HOUR, "reschedule-stale");
    const stale = (await jobRow(jobId)).lock_version;
    await unwrap(reschedule(jobId, new Date(Date.now() + 3 * HOUR)));

    expectCode((await reschedule(jobId, new Date(), editor, stale)).error, "FT002");
  });

  it("refuses an article that is not scheduled", async () => {
    const { jobId } = await runToApproved(editor, { slug: "reschedule-approved" });
    expectCode((await reschedule(jobId, new Date())).error, "FT001");
  });

  it("refuses a time more than a year out, and refuses a viewer", async () => {
    const jobId = await scheduledJob(HOUR, "reschedule-horizon");
    expectCode((await reschedule(jobId, new Date(Date.now() + 400 * 24 * HOUR))).error, "FT005");
    expect((await reschedule(jobId, new Date(), viewer)).error).not.toBeNull();
    // The refused attempts left the original time in place.
    expect((await jobRow(jobId)).status).toBe("SCHEDULED");
    expect(await claim()).toBeNull();
  });
});
