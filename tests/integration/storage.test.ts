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
import { createJob } from "./helpers/workflow";

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

beforeAll(async () => {
  await resetWorkflowData();
  editor = await adminUser("editor");
  viewer = await adminUser("viewer");
  outsider = await signedInUser("storage-outsider");
  jobId = await createJob(editor);
});

afterAll(closeDb);

describe("article-work (private)", () => {
  it("accepts editor uploads under an existing job", async () => {
    const { error } = await editor.client.storage
      .from("article-work")
      .upload(`jobs/${jobId}/images/hero-v1.png`, png, upload);
    expect(error).toBeNull();
  });

  it("rejects paths outside an existing job and path traversal", async () => {
    const missingJob = await editor.client.storage
      .from("article-work")
      .upload(`jobs/${crypto.randomUUID()}/images/hero.png`, png, upload);
    expect(missingJob.error).not.toBeNull();
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
      .upload(`jobs/${jobId}/images/hero-v1.png`, png, { ...upload, upsert: true });
    expect(overwrite.error).not.toBeNull();
    const removed = await editor.client.storage
      .from("article-work")
      .remove([`jobs/${jobId}/images/hero-v1.png`]);
    // Storage reports success with an empty list when RLS filters out every object.
    expect(removed.data ?? []).toEqual([]);
    const stillThere = await viewer.client.storage
      .from("article-work")
      .download(`jobs/${jobId}/images/hero-v1.png`);
    expect(stillThere.error).toBeNull();
  });

  it("lets viewers read but not upload", async () => {
    const read = await viewer.client.storage
      .from("article-work")
      .download(`jobs/${jobId}/images/hero-v1.png`);
    expect(read.error).toBeNull();
    const write = await viewer.client.storage
      .from("article-work")
      .upload(`jobs/${jobId}/images/viewer.png`, png, upload);
    expect(write.error).not.toBeNull();
  });

  it("is invisible to anonymous visitors and non-admin users", async () => {
    for (const client of [anonClient(), outsider.client]) {
      const read = await client.storage
        .from("article-work")
        .download(`jobs/${jobId}/images/hero-v1.png`);
      expect(read.error).not.toBeNull();
      const write = await client.storage
        .from("article-work")
        .upload(`jobs/${jobId}/images/intruder.png`, png, upload);
      expect(write.error).not.toBeNull();
    }
    const direct = await fetch(
      `${localSupabase().apiUrl}/storage/v1/object/public/article-work/jobs/${jobId}/images/hero-v1.png`,
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
