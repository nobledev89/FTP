import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  adminUser,
  closeDb,
  db,
  resetWorkflowData,
  serviceClient,
  type TestUser,
} from "./helpers/clients";
import {
  adminAction,
  claim,
  complete,
  createJob,
  events,
  expectCode,
  expireLease,
  jobRow,
  providerRun,
  researchPacket,
  unwrap,
  WORKER_A,
  WORKER_B,
  type Claim,
} from "./helpers/workflow";

let editor: TestUser;

beforeAll(async () => {
  editor = await adminUser("editor");
});

beforeEach(resetWorkflowData);

afterAll(closeDb);

async function startedJob(): Promise<string> {
  const jobId = await createJob(editor);
  await unwrap(adminAction(editor, jobId, "start"));
  return jobId;
}

describe("claim_next_job", () => {
  it("never gives the same job to two overlapping transactions (FOR UPDATE SKIP LOCKED)", async () => {
    const jobId = await startedJob();
    const first = await db().connect();
    const second = await db().connect();
    try {
      await first.query("begin; set local role service_role");
      await second.query("begin; set local role service_role");

      const a = await first.query("select * from public.claim_next_job($1, 300)", [WORKER_A]);
      // The first transaction still holds the row lock; the second must skip it, not wait or duplicate.
      const b = await second.query("select * from public.claim_next_job($1, 300)", [WORKER_B]);

      expect(a.rows).toHaveLength(1);
      expect(a.rows[0].job_id).toBe(jobId);
      expect(b.rows).toHaveLength(0);

      await first.query("commit");
      await second.query("commit");
    } finally {
      first.release();
      second.release();
    }

    const job = await jobRow(jobId);
    expect(job.status).toBe("RESEARCHING");
    expect(job.lease_owner).toBe(WORKER_A);
    expect(await claim(WORKER_B)).toBeNull();
  });

  it("distributes concurrent claims across distinct jobs exactly once", async () => {
    const jobIds = await Promise.all(Array.from({ length: 5 }, () => startedJob()));
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) => claim(index % 2 === 0 ? WORKER_A : WORKER_B)),
    );
    const claimed = results
      .filter((result): result is Claim => result !== null)
      .map((result) => result.job_id);

    expect(claimed.sort()).toEqual([...jobIds].sort());
    expect(new Set(claimed).size).toBe(5);
  });

  it("filters by stage, records a claim event, and snapshots the provider mode", async () => {
    const jobId = await startedJob();
    expect(await claim(WORKER_A, ["draft"])).toBeNull();

    const claimed = await claim(WORKER_A, ["research"]);
    expect(claimed).toMatchObject({
      job_id: jobId,
      stage: "research",
      status: "RESEARCHING",
      attempt: 1,
      mode: "mock",
    });
    expect((await events(jobId)).at(-1)).toEqual({
      event_type: "stage.claimed",
      from_status: "RESEARCH_PENDING",
      to_status: "RESEARCHING",
    });
  });

  it("rejects malformed worker ids and lease lengths", async () => {
    const badId = await serviceClient().rpc("claim_next_job", { p_worker_id: "Bad Worker" });
    expectCode(badId.error, "22023");
    const badLease = await serviceClient().rpc("claim_next_job", {
      p_worker_id: WORKER_A,
      p_lease_seconds: 5,
    });
    expectCode(badLease.error, "22023");
  });
});

describe("leases", () => {
  it("renew only with the matching worker and token, without bumping lock_version", async () => {
    const jobId = await startedJob();
    const claimed = (await claim(WORKER_A))!;
    const before = await jobRow(jobId);

    const wrongToken = await serviceClient().rpc("renew_lease", {
      p_job_id: jobId,
      p_worker_id: WORKER_A,
      p_lease_token: crypto.randomUUID(),
    });
    expectCode(wrongToken.error, "FT003");

    const wrongWorker = await serviceClient().rpc("renew_lease", {
      p_job_id: jobId,
      p_worker_id: WORKER_B,
      p_lease_token: claimed.lease_token,
    });
    expectCode(wrongWorker.error, "FT003");

    const renewed = await unwrap(
      serviceClient().rpc("renew_lease", {
        p_job_id: jobId,
        p_worker_id: WORKER_A,
        p_lease_token: claimed.lease_token,
        p_lease_seconds: 1200,
      }),
    );
    const after = await jobRow(jobId);
    expect(new Date(renewed).getTime()).toBeGreaterThan(
      new Date(before.lease_expires_at!).getTime(),
    );
    expect(after.lock_version).toBe(before.lock_version);
  });

  it("recover a crashed worker's job so another worker can claim it, and fence off the old worker", async () => {
    const jobId = await startedJob();
    const crashed = (await claim(WORKER_A))!;
    await expireLease(jobId);

    const recovered = await unwrap(serviceClient().rpc("recover_expired_leases"));
    expect(recovered).toBe(1);

    const job = await jobRow(jobId);
    expect(job.status).toBe("RESEARCH_PENDING");
    expect(job.lease_token).toBeNull();
    expect((await events(jobId)).at(-1)).toEqual({
      event_type: "lease.expired",
      from_status: "RESEARCHING",
      to_status: "RESEARCH_PENDING",
    });

    const replacement = (await claim(WORKER_B))!;
    expect(replacement).toMatchObject({ job_id: jobId, attempt: 2 });

    // The crashed worker wakes up and tries to finish with its stale lease.
    await researchPacket(jobId);
    const stale = await complete(crashed, "RESEARCH_COMPLETE", WORKER_A);
    expectCode(stale.error, "FT003");

    await unwrap(complete(replacement, "RESEARCH_COMPLETE", WORKER_B));
    expect((await jobRow(jobId)).status).toBe("DRAFT_PENDING");
  });

  it("fail the job when the final attempt's lease expires", async () => {
    const jobId = await startedJob();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const claimed = await claim(WORKER_A);
      expect(claimed?.attempt).toBe(attempt);
      await expireLease(jobId);
      await unwrap(serviceClient().rpc("recover_expired_leases"));
    }
    const job = await jobRow(jobId);
    expect(job.status).toBe("FAILED");
    expect(job.failed_stage).toBe("research");
    expect(await claim(WORKER_A)).toBeNull();
  });
});

describe("worker status", () => {
  it("reports heartbeat and exact queue health without claiming or recovering work", async () => {
    const firstJobId = await startedJob();
    const secondJobId = await startedJob();
    const leased = (await claim(WORKER_A, undefined, 300))!;
    expect([firstJobId, secondJobId]).toContain(leased.job_id);
    const claimableJobId = leased.job_id === firstJobId ? secondJobId : firstJobId;

    await unwrap(
      serviceClient().rpc("heartbeat_worker", {
        p_worker_id: WORKER_A,
        p_host_label: "test-host",
        p_version: "0.1.0-test",
        p_current_job_id: leased.job_id,
        p_current_stage: leased.stage,
        p_health: { state: "working" },
      }),
    );

    const before = await jobRow(claimableJobId);
    const snapshot = await unwrap(serviceClient().rpc("worker_status", { p_worker_id: WORKER_A }));
    const after = await jobRow(claimableJobId);
    expect(snapshot).toMatchObject({
      worker: {
        worker_id: WORKER_A,
        host_label: "test-host",
        current_job_id: leased.job_id,
        current_stage: "research",
      },
      queue: {
        claimable: 1,
        leased: 1,
        expired_leases: 0,
      },
    });
    expect(after).toEqual(before);
  });
});

describe("failures and manual waits", () => {
  it("schedules retries with backoff and hides the job until it is due", async () => {
    const jobId = await startedJob();
    const claimed = (await claim(WORKER_A))!;
    const retryAt = new Date(Date.now() + 60_000).toISOString();

    const status = await unwrap(
      serviceClient().rpc("fail_stage", {
        p_job_id: jobId,
        p_worker_id: WORKER_A,
        p_lease_token: claimed.lease_token,
        p_outcome: "retry",
        p_error_class: "transient",
        p_summary: "Network timeout",
        p_retry_at: retryAt,
      }),
    );
    expect(status).toBe("RESEARCH_PENDING");
    expect(await claim(WORKER_A)).toBeNull();
    expect(new Date((await jobRow(jobId)).next_attempt_at!).getTime()).toBe(
      new Date(retryAt).getTime(),
    );
  });

  it("never retries authentication or usage-limit errors; they need a human", async () => {
    const jobId = await startedJob();
    const claimed = (await claim(WORKER_A))!;

    const retry = await serviceClient().rpc("fail_stage", {
      p_job_id: jobId,
      p_worker_id: WORKER_A,
      p_lease_token: claimed.lease_token,
      p_outcome: "retry",
      p_error_class: "auth",
      p_summary: "Codex CLI is logged out",
    });
    expectCode(retry.error, "22023");

    const status = await unwrap(
      serviceClient().rpc("fail_stage", {
        p_job_id: jobId,
        p_worker_id: WORKER_A,
        p_lease_token: claimed.lease_token,
        p_outcome: "needs_human",
        p_error_class: "auth",
        p_summary: "Codex CLI is logged out. Run codex login on the worker PC.",
      }),
    );
    expect(status).toBe("NEEDS_HUMAN");
    const job = await jobRow(jobId);
    expect(job).toMatchObject({
      action_required_kind: "cli_auth",
      needs_human_stage: "research",
      lease_token: null,
    });
  });

  it("releases the lease while a manual provider step waits for input", async () => {
    const jobId = await startedJob();
    const claimed = (await claim(WORKER_A))!;
    const runId = await providerRun(jobId, "research", "action_required");

    const status = await unwrap(
      serviceClient().rpc("request_manual_action", {
        p_job_id: jobId,
        p_worker_id: WORKER_A,
        p_lease_token: claimed.lease_token,
        p_run_id: runId,
        p_message: "Paste the ChatGPT research response",
      }),
    );
    expect(status).toBe("RESEARCHING");
    const job = await jobRow(jobId);
    expect(job).toMatchObject({
      status: "RESEARCHING",
      lease_token: null,
      action_required_kind: "manual_input",
      action_required_run_id: runId,
    });
    expect(await claim(WORKER_B)).toBeNull();
  });
});

describe("optimistic concurrency", () => {
  it("rejects admin actions based on a stale lock_version", async () => {
    const jobId = await createJob(editor);
    const loaded = await jobRow(jobId);
    await unwrap(adminAction(editor, jobId, "start"));

    const stale = await editor.client.rpc("admin_transition_job", {
      p_job_id: jobId,
      p_action: "pause",
      p_expected_lock_version: loaded.lock_version,
    });
    expectCode(stale.error, "FT002");
  });

  it("releases a running worker's lease when an admin pauses, and resumes from the pending status", async () => {
    const jobId = await startedJob();
    const claimed = (await claim(WORKER_A))!;

    await unwrap(adminAction(editor, jobId, "pause"));
    expect(await jobRow(jobId)).toMatchObject({
      status: "PAUSED",
      paused_from_status: "RESEARCH_PENDING",
      lease_token: null,
    });

    await researchPacket(jobId);
    const fenced = await complete(claimed, "RESEARCH_COMPLETE");
    expectCode(fenced.error, "FT003");

    await unwrap(adminAction(editor, jobId, "resume"));
    expect((await jobRow(jobId)).status).toBe("RESEARCH_PENDING");
  });
});
