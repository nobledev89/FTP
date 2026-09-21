import type { Metadata } from "next";
import Link from "next/link";

import { AdminShell } from "@/components/admin/admin-shell";
import { Cell, FilterTabs, Pager, Table, TableHead, TableRow } from "@/components/admin/data-table";
import { JobStatusBadge } from "@/components/admin/job-status-badge";
import { EmptyState, Notice, Panel, StatTile } from "@/components/admin/panel";
import { StatusBadge } from "@/components/admin/status-badge";
import { getAdminDashboard } from "@/lib/admin/dashboard";
import { listReadyForReview } from "@/lib/admin/discovery";
import { formatCount, formatDateTime, formatRelativeTime } from "@/lib/admin/format";
import { GROUP_LABELS, filterParams, parseJobFilters } from "@/lib/admin/job-filters";
import { listJobs } from "@/lib/admin/jobs";
import { DEFAULT_PAGE_SIZE, parsePage } from "@/lib/admin/pagination";
import {
  actionRequiredLabel,
  articleStatusTone,
  shortId,
  stageLabel,
  workerStateTone,
} from "@/lib/admin/status-display";
import { requireAdminSession } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

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
    listJobs(filters, page, DEFAULT_PAGE_SIZE),
    listReadyForReview(session.siteId),
  ]);

  const generatedAt = new Date(dashboard.generated_at);
  const onlineWorkers = dashboard.workers.filter((worker) => worker.state === "online");

  return (
    <AdminShell
      actions={
        <span className="hidden items-center gap-2 text-xs text-text-muted sm:flex">
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${onlineWorkers.length > 0 ? "bg-success" : "bg-danger"}`}
          />
          {onlineWorkers.length > 0
            ? `${onlineWorkers.length} worker${onlineWorkers.length === 1 ? "" : "s"} online`
            : "No worker online"}
        </span>
      }
      currentHref="/admin"
      session={session}
      title="Dashboard"
    >
      <div className="grid gap-4">
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

        {readyForReview.length > 0 ? (
          <Panel
            description="Written and audited. Open each one to read it, then schedule it or discard it."
            title={`Ready for review (${readyForReview.length})`}
          >
            <ul className="grid gap-3">
              {readyForReview.map((item) => (
                <li className="grid gap-1" key={item.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    {item.category ? <StatusBadge tone="info">{item.category}</StatusBadge> : null}
                    <Link
                      className="text-sm font-medium text-accent hover:underline"
                      href={`/admin/articles/${item.id}`}
                    >
                      {item.topic}
                    </Link>
                  </div>
                  {item.discovery_source ? (
                    <p className="text-xs text-text-muted">
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
                  <p className="font-mono text-[11px] text-text-subtle">
                    {item.origin === "discovery" ? "discovered" : "editor"} · ready{" "}
                    {formatRelativeTime(item.updated_at, generatedAt)}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <section aria-label="Queue summary">
          <h2 className="sr-only">Queue summary</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Jobs" value={formatCount(dashboard.totals.jobs)} />
            <StatTile
              hint="A worker holds a lease"
              label="Running"
              value={formatCount(dashboard.totals.active)}
            />
            <StatTile
              hint="Waiting on a person"
              label="Awaiting input"
              value={formatCount(dashboard.totals.awaiting_action)}
            />
            <StatTile label="Failed" value={formatCount(dashboard.totals.failed)} />
            <StatTile label="Escalated" value={formatCount(dashboard.totals.needs_human)} />
            <StatTile
              hint="Last 7 days"
              label="Published"
              value={formatCount(dashboard.totals.published_last_7_days)}
            />
          </div>
        </section>

        {Object.keys(dashboard.stage_counts).length > 0 ? (
          <Panel description="Where the open jobs currently sit." title="Stages">
            <ul className="flex flex-wrap gap-2">
              {Object.entries(dashboard.stage_counts).map(([stage, count]) => (
                <li
                  className="flex items-center gap-2 rounded-control border border-border px-2.5 py-1 text-xs"
                  key={stage}
                >
                  <span className="font-medium">
                    {stageLabel(stage as Parameters<typeof stageLabel>[0])}
                  </span>
                  <span className="font-mono tabular-nums text-text-muted">{count}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-2">
          <Panel
            description="Manual provider steps, expired CLI sign-ins, and editorial escalations."
            title="Awaiting input"
          >
            {dashboard.action_required.length === 0 ? (
              <EmptyState>Nothing is waiting on a person.</EmptyState>
            ) : (
              <ul className="grid gap-3">
                {dashboard.action_required.map((row) => (
                  <li className="grid gap-1" key={row.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="warning">{actionRequiredLabel(row.kind)}</StatusBadge>
                      <Link
                        className="text-sm font-medium text-accent hover:underline"
                        href={`/admin/articles/${row.id}`}
                      >
                        {row.topic}
                      </Link>
                    </div>
                    {row.message ? <p className="text-xs text-text-muted">{row.message}</p> : null}
                    <p className="font-mono text-[11px] text-text-subtle">
                      {row.status} · waiting since {formatDateTime(row.since)} (
                      {formatRelativeTime(row.since, generatedAt)})
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
                  <li className="grid gap-1" key={row.id}>
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
                      {row.attempt_count}/{row.max_attempts} · {formatDateTime(row.updated_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel description="Approved and scheduled publications." title="Upcoming">
            {dashboard.upcoming.length === 0 ? (
              <EmptyState>Nothing is approved or scheduled.</EmptyState>
            ) : (
              <ul className="grid gap-3">
                {dashboard.upcoming.map((row) => (
                  <li className="grid gap-1" key={row.id}>
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

          <Panel description="Live on the publication." title="Recent publications">
            {dashboard.recent_publications.length === 0 ? (
              <EmptyState>Nothing has been published yet.</EmptyState>
            ) : (
              <ul className="grid gap-3">
                {dashboard.recent_publications.map((row) => (
                  <li className="grid gap-1" key={row.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone={articleStatusTone(row.status)}>{row.status}</StatusBadge>
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
                      /{row.slug} · published {formatDateTime(row.published_at)}
                      {row.verified_at ? ` · verified ${formatDateTime(row.verified_at)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel
          description={`Heartbeats only; the publication never connects to the worker PC. Stale after ${dashboard.worker_thresholds.stale_after_seconds}s, offline after ${dashboard.worker_thresholds.offline_after_seconds}s.`}
          title="Worker health"
        >
          {dashboard.workers.length === 0 ? (
            <EmptyState>No worker has reported in.</EmptyState>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {dashboard.workers.map((worker) => (
                <li className="grid gap-1" key={worker.worker_id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={workerStateTone(worker.state)}>{worker.state}</StatusBadge>
                    <span className="font-mono text-xs">{worker.worker_id}</span>
                  </div>
                  <p className="text-[11px] text-text-subtle">
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

        <Panel
          actions={
            <FilterTabs
              basePath="/admin"
              current={filters.group}
              label="Queue filters"
              options={Object.entries(GROUP_LABELS).map(
                ([value, label]) => [value, label] as const,
              )}
              paramName="group"
              params={filterParams(filters)}
            />
          }
          description={`Generated ${formatDateTime(dashboard.generated_at)}.`}
          flush
          title="Queue"
        >
          {jobs.items.length === 0 ? (
            <div className="p-4">
              <EmptyState>No job matches this filter.</EmptyState>
            </div>
          ) : (
            <Table>
              <TableHead
                columns={["Job", "Topic", "Status", "Attempts", "Publish at", "Updated"]}
              />
              <tbody>
                {jobs.items.map((job) => (
                  <TableRow key={job.id}>
                    <Cell nowrap variant="mono">
                      <Link
                        className="text-accent hover:underline"
                        href={`/admin/articles/${job.id}`}
                        title={job.id}
                      >
                        {shortId(job.id)}
                      </Link>
                    </Cell>
                    <Cell variant="strong">{job.topic}</Cell>
                    <Cell nowrap>
                      <span className="flex items-center gap-1.5">
                        <JobStatusBadge status={job.status} />
                        {job.action_required_kind ? (
                          <StatusBadge tone="warning">
                            {actionRequiredLabel(job.action_required_kind)}
                          </StatusBadge>
                        ) : null}
                      </span>
                    </Cell>
                    <Cell nowrap variant="mono">
                      {job.attempt_count}/{job.max_attempts}
                      {job.revision_count > 0 ? ` · rev ${job.revision_count}` : ""}
                    </Cell>
                    <Cell nowrap variant="mono">
                      {job.desired_publish_at ? formatDateTime(job.desired_publish_at) : "—"}
                    </Cell>
                    <Cell nowrap variant="mono">
                      {formatDateTime(job.updated_at)}
                    </Cell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          )}
          <Pager basePath="/admin" noun="jobs" params={filterParams(filters)} result={jobs} />
        </Panel>
      </div>
    </AdminShell>
  );
}
