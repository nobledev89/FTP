import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  adminUser,
  anonClient,
  closeDb,
  resetWorkflowData,
  serviceClient,
  signedInUser,
  type TestUser,
} from "./helpers/clients";
import { localSupabase } from "./helpers/env";
import {
  adminAction,
  claimFor,
  complete,
  createJob,
  draft,
  researchPacket,
  unwrap,
  WORKER_A,
} from "./helpers/workflow";

// 1x1 transparent PNG.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const upload = { contentType: "image/png", upsert: false } as const;

let editor: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let jobId: string;
let runId: string;
let manualPath: string;

beforeAll(async () => {
  await resetWorkflowData();
  editor = await adminUser("editor");
  viewer = await adminUser("viewer");
  outsider = await signedInUser("storage-outsider");
  jobId = await createJob(editor, { imageCount: 1, imagesMode: "manual_gemini" });
  await unwrap(adminAction(editor, jobId, "start"));

  let claimed = await claimFor(jobId);
  const { packetId } = await researchPacket(jobId);
  await unwrap(complete(claimed, "RESEARCH_COMPLETE"));

  claimed = await claimFor(jobId);
  await draft(jobId, packetId);
  await unwrap(complete(claimed, "DRAFT_COMPLETE"));

  claimed = await claimFor(jobId);
  const run = await unwrap(
    serviceClient()
      .from("provider_runs")
      .insert({
        job_id: jobId,
        stage: "images",
        provider: "gemini",
        mode: "manual_gemini",
        idempotency_key: `${jobId}:images:storage-policy`,
        schema_version: "images-1",
        status: "action_required",
        prompt_snapshot: "Manual image prompt",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single(),
  );
  runId = run.id;
  await unwrap(
    serviceClient().rpc("request_manual_action", {
      p_job_id: jobId,
      p_worker_id: WORKER_A,
      p_lease_token: claimed.lease_token,
      p_run_id: runId,
      p_message: "Upload the manual image",
    }),
  );
  manualPath = `jobs/${jobId}/manual/${runId}/slot-0-${crypto.randomUUID()}.png`;
});

afterAll(closeDb);

describe("article-work (private)", () => {
  it("accepts editor uploads only for the current manual-image run", async () => {
    const { error } = await editor.client.storage
      .from("article-work")
      .upload(manualPath, png, upload);
    expect(error).toBeNull();
  });

  it("rejects other jobs, runs, slots, generic paths, and path traversal", async () => {
    const missingJob = await editor.client.storage
      .from("article-work")
      .upload(
        `jobs/${crypto.randomUUID()}/manual/${runId}/slot-0-${crypto.randomUUID()}.png`,
        png,
        upload,
      );
    expect(missingJob.error).not.toBeNull();
    const wrongRun = await editor.client.storage
      .from("article-work")
      .upload(
        `jobs/${jobId}/manual/${crypto.randomUUID()}/slot-0-${crypto.randomUUID()}.png`,
        png,
        upload,
      );
    expect(wrongRun.error).not.toBeNull();
    const wrongSlot = await editor.client.storage
      .from("article-work")
      .upload(`jobs/${jobId}/manual/${runId}/slot-1-${crypto.randomUUID()}.png`, png, upload);
    expect(wrongSlot.error).not.toBeNull();
    const generic = await editor.client.storage
      .from("article-work")
      .upload(`jobs/${jobId}/images/hero.png`, png, upload);
    expect(generic.error).not.toBeNull();
    const outside = await editor.client.storage
      .from("article-work")
      .upload("loose/hero.png", png, upload);
    expect(outside.error).not.toBeNull();
    const traversal = await editor.client.storage
      .from("article-work")
      .upload(`jobs/${jobId}/../escape.png`, png, upload);
    expect(traversal.error).not.toBeNull();
  });

  it("does not allow overwriting or deleting uploaded working assets", async () => {
    const overwrite = await editor.client.storage
      .from("article-work")
      .upload(manualPath, png, { ...upload, upsert: true });
    expect(overwrite.error).not.toBeNull();
    const removed = await editor.client.storage.from("article-work").remove([manualPath]);
    // Storage reports success with an empty list when RLS filters out every object.
    expect(removed.data ?? []).toEqual([]);
    const stillThere = await viewer.client.storage.from("article-work").download(manualPath);
    expect(stillThere.error).toBeNull();
  });

  it("lets viewers read but not upload", async () => {
    const read = await viewer.client.storage.from("article-work").download(manualPath);
    expect(read.error).toBeNull();
    const write = await viewer.client.storage
      .from("article-work")
      .upload(`jobs/${jobId}/manual/${runId}/slot-0-${crypto.randomUUID()}.png`, png, upload);
    expect(write.error).not.toBeNull();
  });

  it("is invisible to anonymous visitors and non-admin users", async () => {
    for (const client of [anonClient(), outsider.client]) {
      const read = await client.storage.from("article-work").download(manualPath);
      expect(read.error).not.toBeNull();
      const write = await client.storage
        .from("article-work")
        .upload(`jobs/${jobId}/manual/${runId}/slot-0-${crypto.randomUUID()}.png`, png, upload);
      expect(write.error).not.toBeNull();
    }
    const direct = await fetch(
      `${localSupabase().apiUrl}/storage/v1/object/public/article-work/${manualPath}`,
    );
    expect(direct.ok).toBe(false);
  });
});

describe("article-public", () => {
  it("serves published copies publicly but accepts writes only from the service role", async () => {
    const path = `articles/storage-test/hero-${crypto.randomUUID().slice(0, 8)}.png`;
    const bySevice = await serviceClient().storage.from("article-public").upload(path, png, upload);
    expect(bySevice.error).toBeNull();

    const url = anonClient().storage.from("article-public").getPublicUrl(path).data.publicUrl;
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");

    for (const client of [anonClient(), editor.client]) {
      const write = await client.storage
        .from("article-public")
        .upload(`articles/storage-test/${crypto.randomUUID()}.png`, png, upload);
      expect(write.error).not.toBeNull();
    }
  });

  it("rejects file types other than images", async () => {
    const { error } = await serviceClient()
      .storage.from("article-public")
      .upload("articles/storage-test/script.html", Buffer.from("<script>alert(1)</script>"), {
        contentType: "text/html",
      });
    expect(error).not.toBeNull();
  });
});
