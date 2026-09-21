import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminShell } from "@/components/admin/admin-shell";
import { AuditChecklist } from "@/components/admin/audit-checklist";
import { Cell, FilterTabs, Pager, Table, TableHead, TableRow } from "@/components/admin/data-table";
import { DecisionPanel } from "@/components/admin/decision-panel";
import { DraftPreview } from "@/components/admin/draft-preview";
import { HeroReplacementPanel } from "@/components/admin/hero-replacement-panel";
import { EditorialBadge } from "@/components/admin/editorial-badge";
import { JobControls } from "@/components/admin/job-controls";
import { JobStatusBadge } from "@/components/admin/job-status-badge";
import { LiveRefresh } from "@/components/admin/live-refresh";
import { ManualActionPanel } from "@/components/admin/manual-action-panel";
import { DefinitionList, EmptyState, JsonBlock, Notice, Panel } from "@/components/admin/panel";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatCost, formatDateTime, formatElapsed, formatRelativeTime } from "@/lib/admin/format";
import { availableControls, resolutionDestinations } from "@/lib/admin/job-controls";
import {
  getDraftBody,
  getHeroPreview,
  getImagePreview,
  getJobDetail,
  getLiveHeroPreview,
  listJobEvents,
  listSources,
} from "@/lib/admin/jobs";
import { parsePage } from "@/lib/admin/pagination";
import {
  actionRequiredLabel,
  articleStatusTone,
  articleTypeLabel,
  errorClassLabel,
  logOutcomeTone,
  providerModeLabel,
  runStatusTone,
  shortId,
  stageLabel,
} from "@/lib/admin/status-display";
import { requireAdminSession } from "@/lib/auth/dal";
import { utcIsoToZonedLocal } from "@/lib/format/timezone";
import { siteConfig } from "@/lib/site/config";
import { stageForStatus } from "@/lib/state-machine/transitions";
import { draftOutputSchema } from "@/lib/validation/artifacts";

export const metadata: Metadata = {
  title: "Article",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const EVENT_PAGE_SIZE = 20;

const VIEWS = [
  ["article", "Article"],
  ["details", "Technical details"],
] as const;

type ArticleDetailPageProps = {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ArticleDetailPage({ params, searchParams }: ArticleDetailPageProps) {
  const session = await requireAdminSession();
  const now = new Date();
  const serverUpdatedAt = now.toISOString();
  const { jobId } = await params;
  const query = await searchParams;

  const detail = await getJobDetail(jobId);
  if (!detail) notFound();

  const { job } = detail;
  const view = firstParam(query.view) === "details" ? "details" : "article";
  const eventPage = parsePage(query.page);
  const selectedDraftVersion = Number.parseInt(firstParam(query.draft) ?? "", 10);
  const latestDraft = detail.drafts[0];
  const draftVersion = Number.isSafeInteger(selectedDraftVersion)
    ? selectedDraftVersion
    : (latestDraft?.version ?? null);

  // A manual image run briefs from the draft version it was prepared from, which is not
  // necessarily the version selected for viewing below.
  const manualImageDraftVersion =
    detail.manualAction?.stage === "images" &&
    typeof detail.manualAction.input_refs.draft_version === "number"
      ? detail.manualAction.input_refs.draft_version
      : null;

  const [events, sources, draftBody, manualImageDraft, hero, liveHero, candidateHero] =
    await Promise.all([
      view === "details"
        ? listJobEvents(job.id, eventPage, EVENT_PAGE_SIZE)
        : Promise.resolve(null),
      view === "details" ? listSources(job.id) : Promise.resolve([]),
      draftVersion === null ? Promise.resolve(null) : getDraftBody(job.id, draftVersion),
      manualImageDraftVersion === null
        ? Promise.resolve(null)
        : getDraftBody(job.id, manualImageDraftVersion),
      getHeroPreview(detail.images),
      getLiveHeroPreview(detail.images),
      getImagePreview(detail.images, detail.heroReplacement?.image_id ?? null),
    ]);

  const latestAudit = detail.audits[0];
  const snapshot = {
    status: job.status,
    pausedFromStatus: job.paused_from_status,
    failedStage: job.failed_stage,
    needsHumanStage: job.needs_human_stage,
    revisionCount: job.revision_count,
    hasAudit: detail.audits.length > 0,
    hasValidDraft: detail.drafts.some((draft) => draft.validation_status === "valid"),
  };
  const currentStage = stageForStatus(job.status);
  // PAUSED and the other exceptional statuses belong to no stage; show where the job stopped.
  const heldAtStage = job.paused_from_status
    ? stageForStatus(job.paused_from_status)
    : (job.failed_stage ?? job.needs_human_stage);
  const manualImageBriefs = manualImageDraft
    ? draftOutputSchema.shape.imageBriefs.parse(manualImageDraft.image_briefs)
    : [];
  const manualPaused = job.status === "PAUSED";
  const viewParams = draftVersion === null ? {} : { draft: String(draftVersion) };

  return (
    <AdminShell
      actions={
        <div className="flex items-center gap-2">
          <EditorialBadge
            actionRequiredKind={job.action_required_kind}
            articleStatus={detail.article?.status ?? null}
            autoPublish={job.auto_publish}
            status={job.status}
          />
        </div>
      }
      currentHref="/admin"
      session={session}
      title={job.topic}
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-text-subtle">
            <Link className="text-accent hover:underline" href="/admin">
              Dashboard
            </Link>{" "}
            / <span className="font-mono">{shortId(job.id)}</span>
          </p>
          <LiveRefresh serverUpdatedAt={serverUpdatedAt} />
        </div>

        <DecisionPanel article={detail.article} job={job} latestAudit={latestAudit} now={now}>
          <JobControls
            canEdit={session.canEdit}
            controls={availableControls(snapshot)}
            jobId={job.id}
            lockVersion={job.lock_version}
            resolutions={resolutionDestinations(snapshot)}
            scheduledLocal={
              job.desired_publish_at
                ? utcIsoToZonedLocal(job.desired_publish_at, siteConfig.timeZone)
                : null
            }
            snapshot={snapshot}
            withdrawable={
              detail.article && detail.article.status !== "withdrawn"
                ? { slug: detail.article.slug }
                : null
            }
          />
        </DecisionPanel>

        {job.action_required_kind === "manual_input" && detail.manualAction ? (
          <Panel
            description={`Run ${shortId(detail.manualAction.id)} · schema ${detail.manualAction.schema_version}. The prompt snapshot and accepted artifact remain in the audit trail.`}
            title={`Manual ${stageLabel(detail.manualAction.stage)}`}
          >
            {manualPaused ? (
              <div className="mb-4">
                <Notice tone="info">
                  The job is paused. The prompt below is kept; resume the job to import a response.
                </Notice>
              </div>
            ) : null}
            <ManualActionPanel
              canEdit={session.canEdit && !manualPaused}
              existingImages={detail.images.map((image) => ({
                slot: image.slot,
                version: image.version,
                status: image.status,
                providerRunId: image.provider_run_id,
              }))}
              imageBriefs={manualImageBriefs}
              imageCount={job.image_count}
              run={detail.manualAction}
            />
          </Panel>
        ) : null}

        <FilterTabs
          basePath={`/admin/articles/${job.id}`}
          current={view}
          label="Article views"
          options={VIEWS}
          paramName="view"
          params={viewParams}
        />

        {view === "article" ? (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <Panel
              actions={
                detail.drafts.length > 1 ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {detail.drafts.map((draft) => {
                      const active = draft.version === draftVersion;
                      return (
                        <li key={draft.id}>
                          <Link
                            aria-current={active ? "true" : undefined}
                            className={
                              active
                                ? "flex h-7 items-center rounded-control border border-border-strong bg-neutral-bg px-2 font-mono text-[11px] font-medium"
                                : "flex h-7 items-center rounded-control border border-border px-2 font-mono text-[11px] text-text-muted hover:bg-neutral-bg hover:text-text"
                            }
                            href={`/admin/articles/${job.id}?draft=${draft.version}`}
                          >
                            v{draft.version}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : null
              }
              description={
                latestDraft && draftVersion !== latestDraft.version
                  ? `Showing version ${draftVersion} of ${latestDraft.version}. The newest version is the one that publishes.`
                  : undefined
              }
              title="The article"
            >
              {draftBody ? (
                <DraftPreview
                  bodyMarkdown={draftBody.body_markdown}
                  category={job.category}
                  excerpt={draftBody.excerpt}
                  hero={hero}
                  heroPending={job.image_count > 0 && hero === null}
                  title={draftBody.title}
                />
              ) : (
                <EmptyState>
                  {detail.drafts.length === 0
                    ? "No draft yet. It appears here once the writing step finishes."
                    : "That version does not exist."}
                </EmptyState>
              )}
            </Panel>

            <div className="grid gap-4">
              <Panel
                description="Facts, sources, and style, checked before an article can be published."
                title="The check"
              >
                <AuditChecklist audit={latestAudit} />
              </Panel>

              <Panel title="About this article">
                <DefinitionList
                  columns={1}
                  items={[
                    ["Working title", job.topic],
                    ["Type", articleTypeLabel(job.article_type)],
                    ["Category", job.category ?? "—"],
                    ["Web address", draftBody ? `/blog/${draftBody.slug}` : "Set by the draft"],
                    ["Keywords", job.keywords.length > 0 ? job.keywords.join(", ") : "—"],
                    ["Images requested", String(job.image_count)],
                    [
                      "Byline",
                      job.byline_name
                        ? `${job.byline_name}${job.byline_role ? ` — ${job.byline_role}` : ""}`
                        : "Publication default",
                    ],
                    [
                      "Created",
                      `${formatDateTime(job.created_at)} · ${
                        job.origin === "discovery" ? "found automatically" : "added by an editor"
                      }`,
                    ],
                  ]}
                />
                {job.discovery_source ? (
                  <p className="mt-3 text-sm">
                    <span className="text-xs font-medium uppercase tracking-wide text-text-subtle">
                      Based on
                    </span>{" "}
                    <a
                      className="text-accent hover:underline"
                      href={job.discovery_source.url}
                      rel="noreferrer nofollow"
                      target="_blank"
                    >
                      {job.discovery_source.headline}
                    </a>
                    {job.discovery_source.publisher ? ` · ${job.discovery_source.publisher}` : ""}
                  </p>
                ) : null}
                {job.requirements ? (
                  <div className="mt-3">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-text-subtle">
                      Instructions given
                    </h3>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{job.requirements}</p>
                  </div>
                ) : null}
              </Panel>

              {detail.article ? (
                <Panel title="On the site">
                  <DefinitionList
                    columns={1}
                    items={[
                      [
                        "Status",
                        <StatusBadge key="s" tone={articleStatusTone(detail.article.status)}>
                          {detail.article.status}
                        </StatusBadge>,
                      ],
                      [
                        "Address",
                        <a
                          className="break-all text-accent hover:underline"
                          href={detail.article.canonical_url}
                          key="url"
                          rel="noreferrer"
                          target="_blank"
                        >
                          {detail.article.canonical_url}
                        </a>,
                      ],
                      ["Published", formatDateTime(detail.article.published_at)],
                      ["Checked live", formatDateTime(detail.article.verified_at)],
                      ...(detail.article.withdrawn_at
                        ? ([["Withdrawn", formatDateTime(detail.article.withdrawn_at)]] as const)
                        : []),
                    ]}
                  />
                  {detail.article.status === "withdrawn" ? (
                    <div className="mt-3">
                      <Notice tone="info">
                        <span className="font-mono">/blog/{detail.article.slug}</span> and its
                        earlier addresses now return 404. The reason is on the history.
                      </Notice>
                    </div>
                  ) : null}
                </Panel>
              ) : null}

              {detail.article && detail.article.status !== "withdrawn" ? (
                <Panel
                  description="Swap the picture without touching the article. The worker draws or publishes it; you decide whether it goes live."
                  title="Article image"
                >
                  <HeroReplacementPanel
                    canEdit={session.canEdit}
                    canRegenerate={
                      job.images_mode === "gemini_api" || job.images_mode === "codex_image"
                    }
                    candidate={candidateHero}
                    imagesMode={job.images_mode}
                    jobId={job.id}
                    live={liveHero}
                    lockVersion={job.lock_version}
                    replacement={detail.heroReplacement}
                    slug={detail.article.slug}
                  />
                </Panel>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="State">
                <DefinitionList
                  items={[
                    ["Status", <JobStatusBadge key="status" status={job.status} />],
                    [
                      "Stage",
                      currentStage
                        ? stageLabel(currentStage)
                        : heldAtStage
                          ? `${stageLabel(heldAtStage)} (held)`
                          : "—",
                    ],
                    [
                      "Attempts",
                      `${job.attempt_count} of ${job.max_attempts}${
                        job.next_attempt_at
                          ? ` · next ${formatRelativeTime(job.next_attempt_at, now)}`
                          : ""
                      }`,
                    ],
                    ["Revision cycles used", `${job.revision_count} of 2`],
                    [
                      "Lease",
                      job.lease_owner
                        ? `${job.lease_owner} · expires ${formatRelativeTime(job.lease_expires_at, now)}`
                        : "None",
                    ],
                    [
                      "Publication",
                      job.desired_publish_at
                        ? `${formatDateTime(job.desired_publish_at)} · ${job.auto_publish ? "auto-publish" : "manual"}`
                        : job.auto_publish
                          ? "Auto-publish, no time set"
                          : "Not scheduled",
                    ],
                    [
                      "Lock version",
                      <span className="font-mono" key="lock">
                        {job.lock_version}
                      </span>,
                    ],
                  ]}
                />
              </Panel>

              <Panel
                description="Provider modes were fixed when the job was created."
                title="Providers"
              >
                <DefinitionList
                  columns={2}
                  items={[
                    ["Research", providerModeLabel(job.research_mode)],
                    ["Writing", providerModeLabel(job.writing_mode)],
                    ["Images", providerModeLabel(job.images_mode)],
                    ["Audit", providerModeLabel(job.audit_mode)],
                  ]}
                />
                {job.action_required_kind ? (
                  <div className="mt-3">
                    <Notice tone="warning">
                      <span className="font-medium">
                        {actionRequiredLabel(job.action_required_kind)}
                      </span>
                      {job.action_required_message ? ` — ${job.action_required_message}` : ""}
                      {job.action_required_at
                        ? ` (waiting since ${formatDateTime(job.action_required_at)})`
                        : ""}
                    </Notice>
                  </div>
                ) : null}
              </Panel>
            </div>

            <Panel
              description={`${detail.research.length} research packet${detail.research.length === 1 ? "" : "s"}, newest first.`}
              flush
              title="Research"
            >
              {detail.research.length === 0 ? (
                <div className="p-4">
                  <EmptyState>No research packet yet.</EmptyState>
                </div>
              ) : (
                <Table minWidth="36rem">
                  <TableHead columns={["Version", "Validation", "Summary", "Created"]} />
                  <tbody>
                    {detail.research.map((packet) => (
                      <TableRow key={packet.id}>
                        <Cell variant="mono">v{packet.version}</Cell>
                        <Cell>
                          <StatusBadge
                            tone={packet.validation_status === "valid" ? "success" : "danger"}
                          >
                            {packet.validation_status}
                          </StatusBadge>
                        </Cell>
                        <Cell variant="muted">{packet.summary ?? "—"}</Cell>
                        <Cell nowrap variant="mono">
                          {formatDateTime(packet.created_at)}
                        </Cell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>

            {sources.length > 0 ? (
              <Panel
                description="Structured evidence from the research stage. Private sources are excluded from the published article."
                flush
                title="Sources"
              >
                <Table>
                  <TableHead
                    columns={["Key", "Title", "Publisher", "Quality", "Type", "Accessed"]}
                  />
                  <tbody>
                    {sources.map((source) => (
                      <TableRow key={source.id}>
                        <Cell variant="mono">{source.source_key}</Cell>
                        <Cell>
                          <a
                            className="text-accent hover:underline"
                            href={source.url}
                            rel="noreferrer nofollow"
                            target="_blank"
                          >
                            {source.title}
                          </a>
                          {source.is_private ? (
                            <span className="ml-1.5 font-mono text-[11px] text-text-subtle">
                              private
                            </span>
                          ) : null}
                        </Cell>
                        <Cell variant="muted">{source.publisher ?? "—"}</Cell>
                        <Cell>
                          <StatusBadge tone={source.quality === "primary" ? "success" : "neutral"}>
                            {source.quality}
                          </StatusBadge>
                        </Cell>
                        <Cell variant="muted">{source.source_type}</Cell>
                        <Cell nowrap variant="mono">
                          {formatDateTime(source.accessed_at)}
                        </Cell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </Panel>
            ) : null}

            <Panel description="Every version is kept. Select one to read its body." title="Drafts">
              {detail.drafts.length === 0 ? (
                <EmptyState>No draft yet.</EmptyState>
              ) : (
                <div className="grid gap-4">
                  <ul className="flex flex-wrap gap-1.5">
                    {detail.drafts.map((draft) => {
                      const active = draft.version === draftVersion;
                      return (
                        <li key={draft.id}>
                          <Link
                            aria-current={active ? "true" : undefined}
                            className={
                              active
                                ? "flex h-8 items-center rounded-control border border-border-strong bg-neutral-bg px-3 font-mono text-xs font-medium"
                                : "flex h-8 items-center rounded-control border border-border px-3 font-mono text-xs text-text-muted hover:bg-neutral-bg hover:text-text"
                            }
                            href={`/admin/articles/${job.id}?view=details&draft=${draft.version}`}
                          >
                            v{draft.version}
                            {draft.origin === "admin_edit" ? " · edited" : ""}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>

                  {draftBody ? (
                    <article className="grid gap-3">
                      <DefinitionList
                        items={[
                          ["Title", draftBody.title],
                          [
                            "Slug",
                            <span className="font-mono" key="slug">
                              {draftBody.slug}
                            </span>,
                          ],
                        ]}
                      />
                      <div>
                        <h3 className="text-xs font-medium uppercase tracking-wide text-text-subtle">
                          Excerpt
                        </h3>
                        <p className="mt-1 text-sm">{draftBody.excerpt}</p>
                      </div>
                      <div>
                        <h3 className="text-xs font-medium uppercase tracking-wide text-text-subtle">
                          Body (Markdown)
                        </h3>
                        <pre className="mt-1 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-control border border-border bg-canvas p-3 font-mono text-[11px] leading-relaxed">
                          {draftBody.body_markdown}
                        </pre>
                      </div>
                      {draftBody.source_refs.length > 0 ? (
                        <JsonBlock label="Source references" value={draftBody.source_refs} />
                      ) : null}
                      {draftBody.image_briefs.length > 0 ? (
                        <JsonBlock label="Image briefs" value={draftBody.image_briefs} />
                      ) : null}
                      {draftBody.validation_errors ? (
                        <JsonBlock label="Validation errors" value={draftBody.validation_errors} />
                      ) : null}
                    </article>
                  ) : (
                    <EmptyState>That draft version does not exist.</EmptyState>
                  )}
                </div>
              )}
            </Panel>

            <Panel
              description={
                latestAudit
                  ? `Latest verdict: ${latestAudit.verdict} (cycle ${latestAudit.cycle}).`
                  : "No audit yet."
              }
              title="Audits"
            >
              {detail.audits.length === 0 ? (
                <EmptyState>No audit yet.</EmptyState>
              ) : (
                <ul className="grid gap-4">
                  {detail.audits.map((audit) => (
                    <li className="grid gap-2" key={audit.id}>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          tone={
                            audit.verdict === "PASS"
                              ? "success"
                              : audit.verdict === "REVISION_REQUIRED"
                                ? "warning"
                                : "danger"
                          }
                        >
                          {audit.verdict}
                        </StatusBadge>
                        <span className="font-mono text-xs text-text-muted">
                          v{audit.version} · cycle {audit.cycle} ·{" "}
                          {formatDateTime(audit.created_at)}
                        </span>
                      </div>
                      {audit.summary ? <p className="text-sm">{audit.summary}</p> : null}
                      {audit.findings.length > 0 ? (
                        <JsonBlock
                          label={`${audit.findings.length} finding${audit.findings.length === 1 ? "" : "s"}`}
                          value={audit.findings}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel flush title="Images">
              {detail.images.length === 0 ? (
                <div className="p-4">
                  <EmptyState>No image briefs yet.</EmptyState>
                </div>
              ) : (
                <Table>
                  <TableHead
                    columns={["Slot", "Version", "Role", "Status", "Alt text", "Size", "Created"]}
                  />
                  <tbody>
                    {detail.images.map((image) => (
                      <TableRow key={image.id}>
                        <Cell variant="mono">{image.slot}</Cell>
                        <Cell variant="mono">v{image.version}</Cell>
                        <Cell variant="muted">{image.role}</Cell>
                        <Cell>
                          <StatusBadge
                            tone={
                              image.status === "published" || image.status === "ready"
                                ? "success"
                                : image.status === "rejected"
                                  ? "danger"
                                  : "neutral"
                            }
                          >
                            {image.status}
                          </StatusBadge>
                        </Cell>
                        <Cell variant="muted">{image.alt_text ?? "—"}</Cell>
                        <Cell nowrap variant="mono">
                          {image.width && image.height
                            ? `${image.width}×${image.height} · ${image.aspect_ratio}`
                            : image.aspect_ratio}
                        </Cell>
                        <Cell nowrap variant="mono">
                          {formatDateTime(image.created_at)}
                        </Cell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>

            <Panel flush title="Provider runs">
              {detail.providerRuns.length === 0 ? (
                <div className="p-4">
                  <EmptyState>No provider run yet.</EmptyState>
                </div>
              ) : (
                <Table>
                  <TableHead
                    columns={[
                      "Stage",
                      "Mode",
                      "Attempt",
                      "Status",
                      "Error",
                      "Elapsed",
                      "Cost",
                      "Started",
                    ]}
                  />
                  <tbody>
                    {detail.providerRuns.map((run) => (
                      <TableRow key={run.id}>
                        <Cell variant="strong">{stageLabel(run.stage)}</Cell>
                        <Cell variant="muted">{providerModeLabel(run.mode)}</Cell>
                        <Cell variant="mono">
                          {run.attempt}
                          {run.cycle > 0 ? ` · c${run.cycle}` : ""}
                        </Cell>
                        <Cell>
                          <StatusBadge tone={runStatusTone(run.status)}>{run.status}</StatusBadge>
                        </Cell>
                        <Cell variant="muted">
                          {run.error_class ? (
                            <>
                              <span className="font-medium">
                                {errorClassLabel(run.error_class)}
                              </span>
                              {run.error_summary ? ` — ${run.error_summary}` : ""}
                            </>
                          ) : (
                            "—"
                          )}
                        </Cell>
                        <Cell nowrap variant="mono">
                          {formatElapsed(run.started_at, run.finished_at)}
                        </Cell>
                        <Cell nowrap variant="mono">
                          {formatCost(run.cost_amount, run.cost_currency)}
                        </Cell>
                        <Cell nowrap variant="mono">
                          {formatDateTime(run.started_at)}
                        </Cell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>

            <Panel
              description="Publishing, cache revalidation, and each post-publish verification check."
              flush
              title="Publishing and verification"
            >
              {detail.publishingLogs.length === 0 ? (
                <div className="p-4">
                  <EmptyState>Nothing has been published yet.</EmptyState>
                </div>
              ) : (
                <Table>
                  <TableHead
                    columns={["Kind", "Check", "Outcome", "HTTP", "Attempt", "Error", "When"]}
                  />
                  <tbody>
                    {detail.publishingLogs.map((log) => (
                      <TableRow key={log.id}>
                        <Cell variant="strong">{log.kind}</Cell>
                        <Cell variant="mono">{log.check_name ?? "—"}</Cell>
                        <Cell>
                          <StatusBadge tone={logOutcomeTone(log.outcome)}>
                            {log.outcome}
                          </StatusBadge>
                        </Cell>
                        <Cell variant="mono">{log.http_status ?? "—"}</Cell>
                        <Cell variant="mono">{log.attempt}</Cell>
                        <Cell variant="muted">{log.error ?? "—"}</Cell>
                        <Cell nowrap variant="mono">
                          {formatDateTime(log.created_at)}
                        </Cell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>

            <Panel
              description="Append-only history. New events appear automatically while this page is open."
              flush
              title="Timeline"
            >
              {!events || events.items.length === 0 ? (
                <div className="p-4">
                  <EmptyState>No events yet.</EmptyState>
                </div>
              ) : (
                <Table>
                  <TableHead columns={["When", "Event", "Transition", "Actor", "Note"]} />
                  <tbody>
                    {events.items.map((event) => (
                      <TableRow key={event.id}>
                        <Cell nowrap variant="mono">
                          {formatDateTime(event.created_at)}
                        </Cell>
                        <Cell variant="mono">{event.event_type}</Cell>
                        <Cell nowrap variant="mono">
                          {event.from_status ?? "—"} → {event.to_status ?? "—"}
                        </Cell>
                        <Cell variant="muted">{event.actor_type}</Cell>
                        <Cell variant="muted">{event.note ?? "—"}</Cell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              )}
              {events ? (
                <Pager
                  basePath={`/admin/articles/${job.id}`}
                  noun="events"
                  params={{ ...viewParams, view: "details" }}
                  result={events}
                />
              ) : null}
            </Panel>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
