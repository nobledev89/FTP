import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSupabaseContentRepository } from "@/lib/content/repository";
import { ArtifactVersionConflictError } from "@/lib/content/versioning";
import { WorkflowError } from "@/lib/state-machine/errors";
import {
  createAdminWorkflowService,
  createWorkerWorkflowService,
} from "@/lib/state-machine/supabase";

import {
  adminUser,
  closeDb,
  resetWorkflowData,
  serviceClient,
  type TestUser,
} from "./helpers/clients";
import { createJob, jobRow, WORKER_A } from "./helpers/workflow";

let editor: TestUser;

beforeAll(async () => {
  editor = await adminUser("editor");
});

beforeEach(resetWorkflowData);

afterAll(closeDb);

const packet = {
  topicInterpretation: "How UK merchants are adopting pay by bank",
  angle: "The operational choices behind adoption",
  facts: ["The FCA is the UK conduct regulator."],
  claims: [
    {
      claimKey: "C1",
      text: "The FCA regulates payment conduct in the UK.",
      status: "supported" as const,
      confidence: 0.98,
      jurisdiction: "UK",
      effectiveDate: null,
      asOfDate: "2026-09-17",
      entities: ["FCA"],
      notes: null,
      evidence: [{ sourceKey: "S1", relation: "supports" as const, locator: "About the FCA" }],
    },
  ],
  statistics: [],
  dates: ["2026-09-17"],
  entities: ["FCA"],
  sources: [
    {
      sourceKey: "S1",
      url: "https://www.fca.org.uk/",
      title: "Financial Conduct Authority",
      publisher: "FCA",
      publishedOn: null,
      sourceType: "regulator" as const,
      quality: "primary" as const,
      jurisdiction: "UK",
      accessedAt: "2026-09-17T12:00:00Z",
      excerpt: null,
      isPrivate: false,
    },
  ],
  contradictions: [],
  uncertainties: [],
  questions: [],
  recommendedStructure: ["What changed", "What merchants should do"],
};

describe("Phase 3 domain services", () => {
  it("validates reads and appends immutable artifact versions and non-transition events", async () => {
    const jobId = await createJob(editor);
    const workerRepository = createSupabaseContentRepository(serviceClient());
    const editorRepository = createSupabaseContentRepository(editor.client);

    expect(await editorRepository.getJob(jobId)).toMatchObject({ id: jobId, status: "IDEA" });

    const event = await workerRepository.appendEvent({
      jobId,
      eventType: "artifact.prepared",
      fromStatus: "IDEA",
      toStatus: "IDEA",
      actorType: "worker",
      actorId: WORKER_A,
      metadata: { kind: "research" },
    });
    expect(event).toMatchObject({ event_type: "artifact.prepared", actor_id: WORKER_A });

    const first = await workerRepository.appendResearch({
      jobId,
      packet,
      summary: "Primary-source research packet",
    });
    expect(first.version).toBe(1);

    await expect(
      workerRepository.appendResearch({
        jobId,
        packet,
        expectedLatestVersion: 0,
      }),
    ).rejects.toBeInstanceOf(ArtifactVersionConflictError);

    const timeline = await editorRepository.listJobEvents(jobId);
    expect(timeline.map((entry) => entry.event_type)).toEqual(["job.created", "artifact.prepared"]);
  });

  it("uses optimistic admin commands and the worker completion boundary", async () => {
    const jobId = await createJob(editor);
    const admin = createAdminWorkflowService(editor.client);
    const worker = createWorkerWorkflowService(serviceClient());
    const artifacts = createSupabaseContentRepository(serviceClient());

    const started = await admin.start(jobId, 0);
    expect(started).toEqual({ status: "RESEARCH_PENDING", lock_version: 1 });

    await expect(admin.pause(jobId, 0)).rejects.toMatchObject<Partial<WorkflowError>>({
      code: "STALE_JOB",
      sqlState: "FT002",
    });

    const claim = await worker.claim(WORKER_A, { stages: ["research"] });
    expect(claim).toMatchObject({ job_id: jobId, status: "RESEARCHING", attempt: 1 });

    await artifacts.appendResearch({ jobId, packet, summary: "Validated research" });
    const completed = await worker.complete({
      jobId,
      workerId: WORKER_A,
      leaseToken: claim!.lease_token,
      toStatus: "RESEARCH_COMPLETE",
      metadata: { artifactVersion: 1 },
    });
    expect(completed).toBe("DRAFT_PENDING");
    expect(await jobRow(jobId)).toMatchObject({ status: "DRAFT_PENDING", lease_token: null });
  });
});
