import { randomUUID } from "node:crypto";

import type { Database } from "@/lib/supabase/database.types";

import { db, serviceClient, type Client, type TestUser } from "./clients";

type Enums = Database["public"]["Enums"];
export type JobStatus = Enums["job_status"];
export type Stage = Enums["pipeline_stage"];

export const WORKER_A = "test-worker-a";
export const WORKER_B = "test-worker-b";

export type Claim = {
  job_id: string;
  stage: Stage;
  status: JobStatus;
  lease_token: string;
  lease_expires_at: string;
  lock_version: number;
  attempt: number;
  revision_count: number;
  mode: Enums["provider_mode"];
};

/** Supabase/PostgREST errors expose the Postgres SQLSTATE as `code`. */
export function expectCode(error: { code?: string } | null, code: string): void {
  if (!error || error.code !== code) {
    throw new Error(`expected SQLSTATE ${code}, received ${JSON.stringify(error)}`);
  }
}

/** Returns the data of a successful Supabase call, failing on errors or missing data. */
export async function unwrap<T>(
  promise: PromiseLike<{ data: T; error: unknown }>,
): Promise<NonNullable<T>> {
  const { data, error } = await promise;
  if (error) {
    throw new Error(JSON.stringify(error));
  }
  if (data === null || data === undefined) {
    throw new Error("expected data but the call returned none");
  }
  return data as NonNullable<T>;
}

/** Fails on errors for calls that return no data, such as updates without `select`. */
export async function succeed(promise: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await promise;
  if (error) {
    throw new Error(JSON.stringify(error));
  }
}

export type JobRow = Database["public"]["Tables"]["article_jobs"]["Row"];

export async function jobRow(jobId: string): Promise<JobRow> {
  const { rows } = await db().query<JobRow>("select * from public.article_jobs where id = $1", [
    jobId,
  ]);
  if (!rows[0]) {
    throw new Error(`job ${jobId} not found`);
  }
  return rows[0];
}

export async function events(
  jobId: string,
): Promise<
  Array<{ event_type: string; from_status: JobStatus | null; to_status: JobStatus | null }>
> {
  const { rows } = await db().query(
    "select event_type, from_status, to_status from public.job_events where job_id = $1 order by id",
    [jobId],
  );
  return rows;
}

type JobOptions = {
  imageCount?: number;
  autoPublish?: boolean;
  desiredPublishAt?: string | null;
  topic?: string;
  keywords?: string[];
  researchMode?: Enums["provider_mode"];
  writingMode?: Enums["provider_mode"];
  imagesMode?: Enums["provider_mode"];
  auditMode?: Enums["provider_mode"];
};

export async function createJob(admin: TestUser, options: JobOptions = {}): Promise<string> {
  return unwrap(
    admin.client.rpc("create_article_job", {
      p_topic: options.topic ?? `Integration topic ${randomUUID().slice(0, 8)}`,
      p_keywords: options.keywords ?? ["payments", "uk"],
      p_image_count: options.imageCount ?? 0,
      p_auto_publish: options.autoPublish ?? false,
      ...(options.desiredPublishAt ? { p_desired_publish_at: options.desiredPublishAt } : {}),
      p_research_mode: options.researchMode ?? "mock",
      p_writing_mode: options.writingMode ?? "mock",
      p_images_mode: options.imagesMode ?? "mock",
      p_audit_mode: options.auditMode ?? "mock",
    }),
  );
}

export async function adminAction(
  admin: TestUser,
  jobId: string,
  action: string,
  extra: { note?: string; to?: JobStatus; desiredPublishAt?: string } = {},
) {
  const job = await jobRow(jobId);
  return admin.client.rpc("admin_transition_job", {
    p_job_id: jobId,
    p_action: action,
    p_expected_lock_version: job.lock_version,
    ...(extra.note ? { p_note: extra.note } : {}),
    ...(extra.to ? { p_to_status: extra.to } : {}),
    ...(extra.desiredPublishAt ? { p_desired_publish_at: extra.desiredPublishAt } : {}),
  });
}

export async function claim(
  workerId = WORKER_A,
  stages?: Stage[],
  leaseSeconds = 300,
  client: Client = serviceClient(),
) {
  const { data, error } = await client.rpc("claim_next_job", {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
    ...(stages ? { p_stages: stages } : {}),
  });
  if (error) {
    throw new Error(JSON.stringify(error));
  }
  return (data as Claim[])[0] ?? null;
}

export async function complete(claimed: Claim, to: JobStatus, workerId = WORKER_A, note?: string) {
  return serviceClient().rpc("complete_stage", {
    p_job_id: claimed.job_id,
    p_worker_id: workerId,
    p_lease_token: claimed.lease_token,
    p_to_status: to,
    ...(note ? { p_note: note } : {}),
  });
}

export async function providerRun(
  jobId: string,
  stage: Stage,
  status: Enums["run_status"] = "succeeded",
): Promise<string> {
  const finished = status === "succeeded" || status === "failed" || status === "cancelled";
  const now = new Date().toISOString();
  const row = await unwrap(
    serviceClient()
      .from("provider_runs")
      .insert({
        job_id: jobId,
        stage,
        provider:
          stage === "publish" || stage === "verify"
            ? "internal"
            : stage === "images"
              ? "gemini"
              : stage === "draft" || stage === "revision"
                ? "anthropic"
                : "openai",
        mode: stage === "publish" || stage === "verify" ? "internal" : "mock",
        idempotency_key: `${jobId}:${stage}:${randomUUID()}`,
        schema_version: "test-1",
        status,
        prompt_snapshot: "Mock prompt",
        started_at: now,
        finished_at: finished ? now : null,
        ...(status === "failed" ? { error_class: "transient" as const } : {}),
      })
      .select("id")
      .single(),
  );
  return row.id;
}

export async function researchPacket(jobId: string, version = 1, valid = true) {
  const runId = await providerRun(jobId, "research");
  const packet = await unwrap(
    serviceClient()
      .from("research_packets")
      .insert({
        job_id: jobId,
        version,
        packet: { angle: "Test angle", claims: [] },
        summary: "Test research summary",
        provider_run_id: runId,
        schema_version: "research-1",
        validation_status: valid ? "valid" : "invalid",
        validation_errors: valid ? null : [{ path: "claims", message: "required" }],
      })
      .select("id")
      .single(),
  );
  const sources = await unwrap(
    serviceClient()
      .from("sources")
      .insert([
        {
          job_id: jobId,
          research_packet_id: packet.id,
          source_key: "S1",
          url: "https://www.fca.org.uk/",
          title: "Financial Conduct Authority",
          publisher: "FCA",
          source_type: "regulator",
          quality: "primary",
          jurisdiction: "UK",
          accessed_at: new Date().toISOString(),
          is_private: false,
        },
        {
          job_id: jobId,
          research_packet_id: packet.id,
          source_key: "S2",
          url: "https://example.com/private-note",
          title: "Private background note",
          publisher: "Example",
          source_type: "other",
          quality: "tertiary",
          jurisdiction: "UK",
          accessed_at: new Date().toISOString(),
          is_private: true,
        },
      ])
      // Bulk inserts send every column; PostgREST would otherwise null out missing keys.
      .select("id, source_key"),
  );
  return { packetId: packet.id, sourceIds: sources.map((source) => source.id) };
}

export async function draft(
  jobId: string,
  packetId: string,
  options: {
    version?: number;
    slug?: string;
    title?: string;
    sourceIds?: string[];
    respondsToAuditId?: string;
    valid?: boolean;
    stage?: Stage;
  } = {},
): Promise<string> {
  const runId = await providerRun(jobId, options.stage ?? "draft");
  const row = await unwrap(
    serviceClient()
      .from("drafts")
      .insert({
        job_id: jobId,
        version: options.version ?? 1,
        research_packet_id: packetId,
        responds_to_audit_id: options.respondsToAuditId ?? null,
        title: options.title ?? "How pay-by-bank changes checkout",
        slug: options.slug ?? `pay-by-bank-${randomUUID().slice(0, 8)}`,
        excerpt: "A test excerpt for integration.",
        body_markdown: "## Heading\n\nBody text for the integration test article.",
        meta_title: "Pay-by-bank at checkout",
        meta_description: "What pay-by-bank changes for UK shoppers.",
        category: "Payments",
        source_refs: options.sourceIds ?? [],
        provider_run_id: runId,
        schema_version: "draft-1",
        validation_status: options.valid === false ? "invalid" : "valid",
        validation_errors: options.valid === false ? [{ path: "body", message: "empty" }] : null,
      })
      .select("id")
      .single(),
  );
  return row.id;
}

export async function audit(
  jobId: string,
  draftId: string,
  verdict: Enums["audit_verdict"],
  options: { version?: number; cycle?: number } = {},
): Promise<string> {
  const runId = await providerRun(jobId, "audit");
  const row = await unwrap(
    serviceClient()
      .from("audits")
      .insert({
        job_id: jobId,
        version: options.version ?? 1,
        draft_id: draftId,
        cycle: options.cycle ?? 0,
        verdict,
        findings:
          verdict === "PASS"
            ? []
            : [
                {
                  severity: "major",
                  category: "facts",
                  location: "para 2",
                  problem: "Unsupported",
                  reason: "No source",
                  recommendation: "Cite",
                },
              ],
        provider_run_id: runId,
        schema_version: "audit-1",
      })
      .select("id")
      .single(),
  );
  return row.id;
}

export async function readyImage(jobId: string, slot = 0): Promise<string> {
  const row = await unwrap(
    serviceClient()
      .from("images")
      .insert({
        job_id: jobId,
        slot,
        version: 1,
        role: slot === 0 ? "hero" : "supporting",
        prompt: "Abstract payments illustration",
        alt_text: "Illustration of a card terminal",
        aspect_ratio: "16:9",
        width: 1600,
        height: 900,
        mime_type: "image/png",
        byte_size: 1024,
        status: "ready",
        private_path: `jobs/${jobId}/images/hero-v1.png`,
      })
      .select("id")
      .single(),
  );
  return row.id;
}

/** Runs a job through research, draft, optional images, and a passing audit. */
export async function runToApproved(
  admin: TestUser,
  options: JobOptions & { slug?: string; title?: string } = {},
): Promise<{ jobId: string; draftId: string; imageIds: string[]; sourceIds: string[] }> {
  const jobId = await createJob(admin, options);
  await unwrap(adminAction(admin, jobId, "start"));
  return runStartedToApproved(jobId, options);
}

/** The pipeline half of `runToApproved`, for jobs that were created some other way. */
export async function runStartedToApproved(
  jobId: string,
  options: JobOptions & { slug?: string; title?: string } = {},
): Promise<{ jobId: string; draftId: string; imageIds: string[]; sourceIds: string[] }> {
  let claimed = await claimFor(jobId, WORKER_A, ["research"]);
  const { packetId, sourceIds } = await researchPacket(jobId);
  await unwrap(complete(claimed, "RESEARCH_COMPLETE"));

  claimed = await claimFor(jobId, WORKER_A, ["draft"]);
  const draftId = await draft(jobId, packetId, {
    sourceIds,
    ...(options.slug ? { slug: options.slug } : {}),
    ...(options.title ? { title: options.title } : {}),
  });
  await unwrap(complete(claimed, "DRAFT_COMPLETE"));

  const imageIds: string[] = [];
  if ((options.imageCount ?? 0) > 0) {
    claimed = await claimFor(jobId, WORKER_A, ["images"]);
    for (let slot = 0; slot < (options.imageCount ?? 0); slot += 1) {
      imageIds.push(await readyImage(jobId, slot));
    }
    await unwrap(complete(claimed, "AUDIT_PENDING"));
  }

  claimed = await claimFor(jobId, WORKER_A, ["audit"]);
  await audit(jobId, draftId, "PASS");
  await unwrap(complete(claimed, "APPROVED"));
  return { jobId, draftId, imageIds, sourceIds };
}

/**
 * Claims the given job, failing if another job is claimed instead. `stages` narrows the claim to
 * one pipeline stage, which a test needs when another job of its own is already sitting in the
 * publish queue: the queue offers publishable work first.
 */
export async function claimFor(
  jobId: string,
  workerId = WORKER_A,
  stages?: Stage[],
): Promise<Claim> {
  const claimed = await claim(workerId, stages);
  if (!claimed || claimed.job_id !== jobId) {
    throw new Error(`expected to claim ${jobId}, got ${JSON.stringify(claimed)}`);
  }
  return claimed;
}

/** Moves a lease into the past, as if the worker died, using the state context the functions use. */
export async function expireLease(jobId: string): Promise<void> {
  const client = await db().connect();
  try {
    await client.query("begin");
    await client.query("select set_config('fintechpulse.state_context', 'transition', true)");
    await client.query(
      "update public.article_jobs set lease_expires_at = now() - interval '1 second' where id = $1",
      [jobId],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
