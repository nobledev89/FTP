import type { Metadata } from "next";
import Link from "next/link";

import { AdminShell } from "@/components/admin/admin-shell";
import { FilterTabs, Pager } from "@/components/admin/data-table";
import { JobStatusBadge } from "@/components/admin/job-status-badge";
import { LiveRefresh } from "@/components/admin/live-refresh";
import { EmptyState, Notice, Panel, StatTile } from "@/components/admin/panel";
import { StatusBadge } from "@/components/admin/status-badge";
import { getAdminDashboard } from "@/lib/admin/dashboard";
import { listReadyForReview } from "@/lib/admin/discovery";
import { formatCount, formatDateTime, formatRelativeTime } from "@/lib/admin/format";
import { filterParams, parseJobFilters } from "@/lib/admin/job-filters";
import { listJobs } from "@/lib/admin/jobs";
import { parsePage } from "@/lib/admin/pagination";
import {
  actionRequiredLabel,
  articleStatusTone,
  stageLabel,
  workerStateTone,
} from "@/lib/admin/status-display";
import { requireAdminSession } from "@/lib/auth/dal";
import { PIPELINE_STAGES, stageForStatus } from "@/lib/state-machine/transitions";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const DASHBOARD_QUEUE_PAGE_SIZE = 10;

const QUEUE_FILTERS = [
  ["all", "All"],
  ["open", "Pipeline"],
  ["action_required", "Needs input"],
  ["blocked", "Blocked"],
  ["scheduled", "Scheduled"],
  ["published", "Published"],
] as const;

type DashboardPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminDashboardPage({ searchParams }: DashboardPageProps) {
  const session = await requireAdminSession();
  const params = await searchParams;
  const filters = parseJobFilters(params);
  const page = parsePage(params.page);

  const [dashboard, jobs, readyForReview] = await Promise.all([
    getAdminDashboard(),
    listJobs(filters, page, DASHBOARD_QUEUE_PAGE_SIZE),
    listReadyForReview(session.siteId),
  ]);

  const generatedAt = new Date(dashboard.generated_at);
  const onlineWorkers = dashboard.workers.filter((worker) => worker.state === "online");
  const activeJobIds = new Set(dashboard.in_progress.map((job) => job.id));
  const stageEntries = PIPELINE_STAGES.map(
    (stage) => [stage, dashboard.stage_counts[stage] ?? 0] as const,
  ).filter(([, count]) => count > 0);
  const largestStage = Math.max(1, ...stageEntries.map(([, count]) => count));

  return (
    <AdminShell
      actions={<LiveRefresh serverUpdatedAt={dashboard.generated_at} />}
      currentHref="/admin"
      session={session}
      title="Dashboard"
    >
      <div className="grid gap-4">
        <section className="overflow-hidden rounded-panel border border-border bg-panel">
          <div className="border-l-4 border-accent px-4 py-4 sm:flex sm:items-center sm:justify-between sm:gap-6 lg:px-5">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
                Operations overview
              </p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">
                Your newsroom, at a glance
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-text-muted">
                Follow automatic work as it moves through the pipeline, then step in only when a job
                needs an editor.
              </p>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 sm:mt-0 sm:justify-end">
              <span className="inline-flex h-8 items-center gap-2 rounded-control border border-border bg-canvas px-3 text-xs font-medium text-text-muted">
                <span
                  aria-hidden="true"
                  className={`size-2 rounded-full ${onlineWorkers.length > 0 ? "bg-success" : "bg-danger"}`}
                />
                {onlineWorkers.length > 0
                  ? `${onlineWorkers.length} worker${onlineWorkers.length === 1 ? "" : "s"} online`
                  : "No worker online"}
              </span>
              <Link
                className="flex h-8 items-center rounded-control bg-accent px-3 text-xs font-semibold text-white hover:bg-accent-hover"
                href="/admin/articles/new"
              >
                New article
              </Link>
            </div>
          </div>
        </section>

        {dashboard.totals.jobs === 0 ? (
          <Notice tone="info">
            No article jobs yet.{" "}
            <Link className="font-medium underline" href="/admin/articles/new">
              Create the first one
            </Link>
            . Nothing runs until a job is started and the local worker is running.
          </Notice>
        ) : null}

        {dashboard.workers.length === 0 ? (
          <Notice tone="warning">
            No worker has ever reported in. Started jobs will sit in their pending status until the
            local worker runs on the owner&rsquo;s PC. See docs/LOCAL-WORKER.md.
          </Notice>
        ) : null}

        <section aria-label="Queue summary">
          <h2 className="sr-only">Queue summary</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <StatTile
              hint="All time"
              label="Total jobs"
              tone="neutral"
              value={formatCount(dashboard.totals.jobs)}
            />
            <StatTile
              hint="Worker has a lease"
              label="Running"
              tone="info"
              value={formatCount(dashboard.totals.active)}
            />
            <StatTile
              hint="Waiting on a person"
              label="Needs input"
              tone="warning"
              value={formatCount(dashboard.totals.awaiting_action)}
            />
            <StatTile
              hint="Attempts exhausted"
              label="Failed"
              tone="danger"
              value={formatCount(dashboard.totals.failed)}
            />
            <StatTile
              hint="Editorial decision"
              label="Escalated"
              tone="danger"
              value={formatCount(dashboard.totals.needs_human)}
            />
            <StatTile
              hint="In the last 7 days"
              label="Published"
              tone="success"
              value={formatCount(dashboard.totals.published_last_7_days)}
            />
          </div>
        </section>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid min-w-0 gap-4">
            {readyForReview.length > 0 ? (
              <Panel
                description="Written and audited. Read each draft, then schedule it or discard it."
                title={`Ready for review (${readyForReview.length})`}
              >
                <ul className="grid gap-3 sm:grid-cols-2">
                  {readyForReview.map((item) => (
                    <li
                      className="rounded-control border border-warning/25 bg-warning-bg p-3"
                      key={item.id}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {item.category ? (
                          <StatusBadge tone="warning">{item.category}</StatusBadge>
                        ) : null}
                        <span className="font-mono text-[11px] text-warning">
                          ready {formatRelativeTime(item.updated_at, generatedAt)}
                        </span>
                      </div>
                      <Link
                        className="mt-2 block text-sm font-semibold text-text hover:text-accent hover:underline"
                        href={`/admin/articles/${item.id}`}
                      >
                        {item.topic}
                      </Link>
                      {item.discovery_source ? (
                        <p className="mt-1 text-xs text-text-muted">
                          From{" "}
                          <a
                            className="hover:underline"
                            href={item.discovery_source.url}
                            rel="noreferrer nofollow"
                            target="_blank"
                          >
                            {item.discovery_source.headline}
                          </a>
                          {item.discovery_source.publisher
                            ? ` · ${item.discovery_source.publisher}`
                            : ""}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            {stageEntries.length > 0 ? (
              <Panel
                description="Open work by pipeline stage. Longer bars mean more jobs are waiting there."
                title="Pipeline distribution"
              >
                <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {stageEntries.map(([stage, count]) => (
                    <li key={stage}>
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                        <span className="font-medium">{stageLabel(stage)}</span>
                        <span className="font-mono tabular-nums text-text-muted">{count}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-control bg-neutral-bg">
                        <div
                          aria-hidden="true"
                          className="h-full rounded-control bg-accent"
                          style={{ width: `${Math.max(8, (count / largestStage) * 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel
                description="Manual steps, expired CLI sign-ins, and editorial decisions."
                title="Awaiting input"
              >
                {dashboard.action_required.length === 0 ? (
                  <EmptyState>Nothing is waiting on a person.</EmptyState>
                ) : (
                  <ul className="grid gap-3">
                    {dashboard.action_required.map((row) => (
                      <li
                        className="grid gap-1 border-b border-border pb-3 last:border-0 last:pb-0"
                        key={row.id}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone="warning">{actionRequiredLabel(row.kind)}</StatusBadge>
                          <Link
                            className="text-sm font-medium text-accent hover:underline"
                            href={`/admin/articles/${row.id}`}
                          >
                            {row.topic}
                          </Link>
                        </div>
                        {row.message ? (
                          <p className="text-xs text-text-muted">{row.message}</p>
                        ) : null}
                        <p className="font-mono text-[11px] text-text-subtle">
                          Waiting {formatRelativeTime(row.since, generatedAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel description="Exhausted attempts and escalations." title="Failed and escalated">
                {dashboard.blocked.length === 0 ? (
                  <EmptyState>No job is blocked.</EmptyState>
                ) : (
                  <ul className="grid gap-3">
                    {dashboard.blocked.map((row) => (
                      <li
                        className="grid gap-1 border-b border-border pb-3 last:border-0 last:pb-0"
                        key={row.id}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <JobStatusBadge status={row.status} />
                          <Link
                            className="text-sm font-medium text-accent hover:underline"
                            href={`/admin/articles/${row.id}`}
                          >
                            {row.topic}
                          </Link>
                        </div>
                        {row.failure_summary ? (
                          <p className="text-xs text-text-muted">{row.failure_summary}</p>
                        ) : null}
                        <p className="font-mono text-[11px] text-text-subtle">
                          {row.failed_stage ?? row.needs_human_stage ?? "—"} · attempt{" "}
                          {row.attempt_count}/{row.max_attempts} · updated{" "}
                          {formatRelativeTime(row.updated_at, generatedAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel description="Approved and scheduled publications." title="Upcoming">
                {dashboard.upcoming.length === 0 ? (
                  <EmptyState>Nothing is approved or scheduled.</EmptyState>
                ) : (
                  <ul className="grid gap-3">
                    {dashboard.upcoming.map((row) => (
                      <li
                        className="grid gap-1 border-b border-border pb-3 last:border-0 last:pb-0"
                        key={row.id}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <JobStatusBadge status={row.status} />
                          <Link
                            className="text-sm font-medium text-accent hover:underline"
                            href={`/admin/articles/${row.id}`}
                          >
                            {row.topic}
                          </Link>
                        </div>
                        <p className="font-mono text-[11px] text-text-subtle">
                          {row.desired_publish_at
                            ? `${formatDateTime(row.desired_publish_at)} (${formatRelativeTime(row.desired_publish_at, generatedAt)})`
                            : "No time set"}
                          {row.auto_publish ? " · auto-publish" : " · manual publish"}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel
                description="The latest stories live on the publication."
                title="Recent publications"
              >
                {dashboard.recent_publications.length === 0 ? (
                  <EmptyState>Nothing has been published yet.</EmptyState>
                ) : (
                  <ul className="grid gap-3">
                    {dashboard.recent_publications.map((row) => (
                      <li
                        className="grid gap-1 border-b border-border pb-3 last:border-0 last:pb-0"
                        key={row.id}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={articleStatusTone(row.status)}>
                            {row.status}
                          </StatusBadge>
                          {row.job_id ? (
                            <Link
                              className="text-sm font-medium text-accent hover:underline"
                              href={`/admin/articles/${row.job_id}`}
                            >
                              {row.title}
                            </Link>
                          ) : (
                            <span className="text-sm font-medium">{row.title}</span>
                          )}
                        </div>
                        <p className="font-mono text-[11px] text-text-subtle">
                          /{row.slug} · published{" "}
                          {formatRelativeTime(row.published_at, generatedAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>

            <Panel
              description={`Heartbeat status. Stale after ${dashboard.worker_thresholds.stale_after_seconds}s; offline after ${dashboard.worker_thresholds.offline_after_seconds}s.`}
              title="Worker health"
            >
              {dashboard.workers.length === 0 ? (
                <EmptyState>No worker has reported in.</EmptyState>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {dashboard.workers.map((worker) => (
                    <li
                      className="rounded-control border border-border bg-canvas p-3"
                      key={worker.worker_id}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={workerStateTone(worker.state)}>
                          {worker.state}
                        </StatusBadge>
                        <span className="font-mono text-xs">{worker.worker_id}</span>
                      </div>
                      <p className="mt-1.5 text-[11px] text-text-subtle">
                        {worker.host_label ? `${worker.host_label} · ` : ""}
                        {worker.version ? `v${worker.version} · ` : ""}last seen{" "}
                        {formatRelativeTime(worker.last_seen_at, generatedAt)}
                        {worker.current_stage ? ` · on ${stageLabel(worker.current_stage)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <aside
            aria-label="Live queue"
            className="order-first grid gap-4 xl:order-last xl:sticky xl:top-20"
          >
            <Panel
              description="Jobs a worker is actively processing right now."
              title={`Processing now (${dashboard.in_progress.length})`}
            >
              {dashboard.in_progress.length === 0 ? (
                <EmptyState>The worker is idle.</EmptyState>
              ) : (
                <ul className="grid gap-3">
                  {dashboard.in_progress.map((job) => {
                    const stage = stageForStatus(job.status);
                    return (
                      <li
                        className="rounded-control border border-info/25 bg-info-bg p-3"
                        key={job.id}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-info">
                            <span aria-hidden="true" className="size-2 rounded-full bg-info" />
                            {stage ? stageLabel(stage) : "Processing"}
                          </span>
                          <span className="font-mono text-[11px] text-text-subtle">
                            {formatRelativeTime(job.updated_at, generatedAt)}
                          </span>
                        </div>
                        <Link
                          className="mt-2 block text-sm font-semibold leading-snug text-text hover:text-accent hover:underline"
                          href={`/admin/articles/${job.id}`}
                        >
                          {job.topic}
                        </Link>
                        <p className="mt-1 font-mono text-[11px] text-text-muted">
                          {job.status}
                          {job.lease_owner ? ` · ${job.lease_owner}` : ""}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>

            <Panel
              description="Newest changes first. Updates automatically every 5 seconds."
              flush
              title="Queue"
            >
              <div className="border-b border-border px-4 py-3">
                <FilterTabs
                  basePath="/admin"
                  current={filters.group}
                  label="Queue filters"
                  options={QUEUE_FILTERS}
                  paramName="group"
                  params={filterParams(filters)}
                />
              </div>
              {jobs.items.length === 0 ? (
                <div className="p-4">
                  <EmptyState>No job matches this filter.</EmptyState>
                </div>
              ) : (
                <ol className="divide-y divide-border">
                  {jobs.items.map((job) => {
                    const stage = stageForStatus(job.status);
                    const active = activeJobIds.has(job.id);
                    return (
                      <li className="relative px-4 py-3" key={job.id}>
                        {active ? (
                          <span
                            aria-hidden="true"
                            className="absolute inset-y-0 left-0 w-1 bg-info"
                          />
                        ) : null}
                        <Link
                          className="block text-sm font-semibold leading-snug text-text hover:text-accent hover:underline"
                          href={`/admin/articles/${job.id}`}
                        >
                          {job.topic}
                        </Link>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <JobStatusBadge status={job.status} />
                          {job.action_required_kind ? (
                            <StatusBadge tone="warning">
                              {actionRequiredLabel(job.action_required_kind)}
                            </StatusBadge>
                          ) : null}
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-3 font-mono text-[11px] text-text-subtle">
                          <span>
                            {active ? "Processing" : stage ? stageLabel(stage) : "Workflow"} ·{" "}
                            {job.attempt_count}/{job.max_attempts} attempts
                          </span>
                          <span className="whitespace-nowrap">
                            {formatRelativeTime(job.updated_at, generatedAt)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
              {jobs.items.length > 0 ? (
                <Pager basePath="/admin" noun="jobs" params={filterParams(filters)} result={jobs} />
              ) : null}
            </Panel>
          </aside>
        </div>
      </div>
    </AdminShell>
  );
}
