import type { Metadata } from "next";
import Link from "next/link";

import { AdminShell } from "@/components/admin/admin-shell";
import { FilterTabs, Pager } from "@/components/admin/data-table";
import { EditorialBadge } from "@/components/admin/editorial-badge";
import { LiveRefresh } from "@/components/admin/live-refresh";
import { EmptyState, Notice, Panel } from "@/components/admin/panel";
import {
  ActionBar,
  DiscardForm,
  PublishNowForm,
  ScheduleForm,
} from "@/components/admin/publication-controls";
import { StatusBadge } from "@/components/admin/status-badge";
import { StepTracker } from "@/components/admin/step-tracker";
import { getAdminDashboard } from "@/lib/admin/dashboard";
import { listReadyForReview } from "@/lib/admin/discovery";
import { formatCount, formatDateTime, formatRelativeTime } from "@/lib/admin/format";
import {
  IN_PROGRESS_STATUSES,
  filterParams,
  parseJobFilters,
  type JobFilters,
} from "@/lib/admin/job-filters";
import { listJobs } from "@/lib/admin/jobs";
import { parsePage } from "@/lib/admin/pagination";
import { actionRequiredLabel, stageLabel } from "@/lib/admin/status-display";
import { requireAdminSession } from "@/lib/auth/dal";
import { utcIsoToZonedLocal } from "@/lib/format/timezone";
import { siteConfig } from "@/lib/site/config";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const QUEUE_PAGE_SIZE = 10;
const IN_PROGRESS_LIMIT = 6;

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

  const inProgressFilters: JobFilters = {
    group: "all",
    statuses: IN_PROGRESS_STATUSES,
    stage: null,
    search: "",
  };

  const [dashboard, jobs, readyForReview, inProgress] = await Promise.all([
    getAdminDashboard(),
    listJobs(filters, page, QUEUE_PAGE_SIZE),
    listReadyForReview(session.siteId),
    listJobs(inProgressFilters, 1, IN_PROGRESS_LIMIT),
  ]);

  const generatedAt = new Date(dashboard.generated_at);
  const onlineWorkers = dashboard.workers.filter((worker) => worker.state === "online");
  // A job waiting on a person is listed under Needs your decision, not twice.
  const waiting = inProgress.items.filter((job) => job.action_required_kind === null);
  const scheduled = dashboard.upcoming.filter(
    (row) => row.status === "SCHEDULED" || row.auto_publish,
  );
  const decisions =
    readyForReview.length + dashboard.action_required.length + dashboard.blocked.length;

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
              <h2 className="text-xl font-semibold tracking-tight">
                {decisions === 0
                  ? "Nothing is waiting on you"
                  : `${decisions} article${decisions === 1 ? "" : "s"} waiting on you`}
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-text-muted">
                {decisions === 0
                  ? "Work in progress appears below as the worker moves it along."
                  : "Read each one, then publish it, schedule it, or discard it."}
              </p>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 sm:mt-0 sm:justify-end">
              <Link
                className="inline-flex h-8 items-center gap-2 rounded-control border border-border bg-canvas px-3 text-xs font-medium text-text-muted hover:bg-neutral-bg"
                href="/admin/providers"
              >
                <span
                  aria-hidden="true"
                  className={`size-2 rounded-full ${onlineWorkers.length > 0 ? "bg-success" : "bg-danger"}`}
                />
                {onlineWorkers.length > 0
                  ? `${onlineWorkers.length} worker${onlineWorkers.length === 1 ? "" : "s"} online`
                  : "No worker online"}
              </Link>
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
            No articles yet.{" "}
            <Link className="font-medium underline" href="/admin/articles/new">
              Write the first one
            </Link>
            , or turn on automatic topic discovery in{" "}
            <Link className="font-medium underline" href="/admin/settings">
              Settings
            </Link>
            .
          </Notice>
        ) : null}

        {dashboard.workers.length === 0 ? (
          <Notice tone="warning">
            No worker has ever reported in. Articles will sit where they are until the local worker
            runs on the owner&rsquo;s PC. See docs/LOCAL-WORKER.md.
          </Notice>
        ) : null}

        <section aria-labelledby="decisions-heading" className="grid gap-3">
          <h2 className="text-sm font-semibold" id="decisions-heading">
            Needs your decision{decisions > 0 ? ` (${decisions})` : ""}
          </h2>

          {decisions === 0 ? (
            <EmptyState>Nothing needs you right now.</EmptyState>
          ) : (
            <div className="grid gap-3">
              {readyForReview.map((item) => (
                <article
                  className="rounded-panel border border-l-4 border-border border-l-warning bg-panel p-4"
                  key={item.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="warning">Ready to publish</StatusBadge>
                    {item.category ? (
                      <span className="text-xs font-medium text-text-muted">{item.category}</span>
                    ) : null}
                    <span className="font-mono text-[11px] text-text-subtle">
                      ready {formatRelativeTime(item.updated_at, generatedAt)}
                    </span>
                  </div>
                  <h3 className="mt-2 text-base font-semibold leading-snug">
                    <Link
                      className="hover:text-accent hover:underline"
                      href={`/admin/articles/${item.id}`}
                    >
                      {item.title ?? item.topic}
                    </Link>
                  </h3>
                  {item.excerpt ? (
                    <p className="mt-1 max-w-3xl text-sm text-text-muted">{item.excerpt}</p>
                  ) : null}
                  {item.discovery_source ? (
                    <p className="mt-1 text-xs text-text-subtle">
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
                  {session.canEdit ? (
                    <div className="mt-3">
                      <ActionBar
                        panels={[
                          {
                            key: "schedule",
                            label: "Schedule",
                            content: (
                              <ScheduleForm
                                jobId={item.id}
                                lockVersion={item.lock_version}
                                scheduledLocal={null}
                              />
                            ),
                          },
                          {
                            key: "discard",
                            label: "Discard",
                            tone: "danger",
                            content: (
                              <DiscardForm jobId={item.id} lockVersion={item.lock_version} />
                            ),
                          },
                        ]}
                      >
                        <PublishNowForm jobId={item.id} lockVersion={item.lock_version} />
                        <Link
                          className="flex h-8 items-center rounded-control border border-border-strong bg-panel px-3 text-sm font-medium hover:bg-neutral-bg"
                          href={`/admin/articles/${item.id}`}
                        >
                          Read it
                        </Link>
                      </ActionBar>
                    </div>
                  ) : null}
                </article>
              ))}

              {dashboard.action_required.map((row) => (
                <article
                  className="rounded-panel border border-l-4 border-border border-l-danger bg-panel p-4"
                  key={row.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone="danger">{actionRequiredLabel(row.kind)}</StatusBadge>
                    <span className="font-mono text-[11px] text-text-subtle">
                      waiting {formatRelativeTime(row.since, generatedAt)}
                    </span>
                  </div>
                  <h3 className="mt-2 text-base font-semibold leading-snug">
                    <Link
                      className="hover:text-accent hover:underline"
                      href={`/admin/articles/${row.id}`}
                    >
                      {row.topic}
                    </Link>
                  </h3>
                  {row.message ? (
                    <p className="mt-1 max-w-3xl text-sm text-text-muted">{row.message}</p>
                  ) : null}
                  <Link
                    className="mt-3 flex h-8 w-fit items-center rounded-control bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover"
                    href={`/admin/articles/${row.id}`}
                  >
                    Open it
                  </Link>
                </article>
              ))}

              {dashboard.blocked.map((row) => (
                <article
                  className="rounded-panel border border-l-4 border-border border-l-danger bg-panel p-4"
                  key={row.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <EditorialBadge status={row.status} />
                    <span className="font-mono text-[11px] text-text-subtle">
                      {(row.failed_stage ?? row.needs_human_stage)
                        ? `stopped at ${stageLabel((row.failed_stage ?? row.needs_human_stage)!)} · `
                        : ""}
                      {formatRelativeTime(row.updated_at, generatedAt)}
                    </span>
                  </div>
                  <h3 className="mt-2 text-base font-semibold leading-snug">
                    <Link
                      className="hover:text-accent hover:underline"
                      href={`/admin/articles/${row.id}`}
                    >
                      {row.topic}
                    </Link>
                  </h3>
                  {row.failure_summary ? (
                    <p className="mt-1 max-w-3xl text-sm text-text-muted">{row.failure_summary}</p>
                  ) : null}
                  <Link
                    className="mt-3 flex h-8 w-fit items-center rounded-control bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover"
                    href={`/admin/articles/${row.id}`}
                  >
                    Open it
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Panel
            description="The worker researches, writes, illustrates, and checks these on its own."
            title={`In progress (${formatCount(inProgress.total ?? waiting.length)})`}
          >
            {waiting.length === 0 ? (
              <EmptyState>Nothing is being worked on.</EmptyState>
            ) : (
              <ul className="grid gap-3">
                {waiting.map((job) => (
                  <li
                    className="grid gap-2 border-b border-border pb-3 last:border-0 last:pb-0"
                    key={job.id}
                  >
                    <Link
                      className="text-sm font-medium leading-snug hover:text-accent hover:underline"
                      href={`/admin/articles/${job.id}`}
                    >
                      {job.topic}
                    </Link>
                    <StepTracker
                      actionRequiredKind={job.action_required_kind}
                      compact
                      imageCount={job.image_count}
                      status={job.status}
                    />
                    <p className="font-mono text-[11px] text-text-subtle">
                      {job.lease_owner ? "running · " : "queued · "}
                      {formatRelativeTime(job.updated_at, generatedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            description="Going live on their own, at these times."
            title={`Scheduled (${scheduled.length})`}
          >
            {scheduled.length === 0 ? (
              <EmptyState>Nothing is scheduled.</EmptyState>
            ) : (
              <ul className="grid gap-3">
                {scheduled.map((row) => (
                  <li
                    className="grid gap-2 border-b border-border pb-3 last:border-0 last:pb-0"
                    key={row.id}
                  >
                    <Link
                      className="text-sm font-medium leading-snug hover:text-accent hover:underline"
                      href={`/admin/articles/${row.id}`}
                    >
                      {row.topic}
                    </Link>
                    <p className="text-xs text-text-muted">
                      {row.desired_publish_at
                        ? `${formatDateTime(row.desired_publish_at)} · ${formatRelativeTime(row.desired_publish_at, generatedAt)}`
                        : "As soon as the worker picks it up"}
                    </p>
                    {session.canEdit && row.status === "SCHEDULED" ? (
                      <ActionBar
                        panels={[
                          {
                            key: "reschedule",
                            label: "Change time",
                            content: (
                              <ScheduleForm
                                jobId={row.id}
                                lockVersion={row.lock_version}
                                scheduledLocal={
                                  row.desired_publish_at
                                    ? utcIsoToZonedLocal(
                                        row.desired_publish_at,
                                        siteConfig.timeZone,
                                      )
                                    : null
                                }
                              />
                            ),
                          },
                        ]}
                      >
                        <PublishNowForm jobId={row.id} lockVersion={row.lock_version} />
                      </ActionBar>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel
          description={`${formatCount(dashboard.totals.published_last_7_days)} published in the last 7 days.`}
          title="Recently live"
        >
          {dashboard.recent_publications.length === 0 ? (
            <EmptyState>Nothing has been published yet.</EmptyState>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {dashboard.recent_publications.map((row) => (
                <li className="grid gap-1" key={row.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={row.status === "withdrawn" ? "neutral" : "success"}>
                      {row.status === "withdrawn" ? "Withdrawn" : "Live"}
                    </StatusBadge>
                    {row.job_id ? (
                      <Link
                        className="text-sm font-medium hover:text-accent hover:underline"
                        href={`/admin/articles/${row.job_id}`}
                      >
                        {row.title}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium">{row.title}</span>
                    )}
                  </div>
                  <p className="font-mono text-[11px] text-text-subtle">
                    /{row.slug} · {formatRelativeTime(row.published_at, generatedAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel description="Everything, newest change first." flush title="All articles">
          <div className="border-b border-border px-4 py-3">
            <FilterTabs
              basePath="/admin"
              current={filters.group}
              label="Article filters"
              options={QUEUE_FILTERS}
              paramName="group"
              params={filterParams(filters)}
            />
          </div>
          {jobs.items.length === 0 ? (
            <div className="p-4">
              <EmptyState>No article matches this filter.</EmptyState>
            </div>
          ) : (
            <ol className="divide-y divide-border">
              {jobs.items.map((job) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  key={job.id}
                >
                  <div className="min-w-0">
                    <Link
                      className="text-sm font-medium leading-snug hover:text-accent hover:underline"
                      href={`/admin/articles/${job.id}`}
                    >
                      {job.topic}
                    </Link>
                    <p className="mt-0.5 font-mono text-[11px] text-text-subtle">
                      {job.category ? `${job.category} · ` : ""}
                      {formatRelativeTime(job.updated_at, generatedAt)}
                    </p>
                  </div>
                  <EditorialBadge
                    actionRequiredKind={job.action_required_kind}
                    autoPublish={job.auto_publish}
                    status={job.status}
                  />
                </li>
              ))}
            </ol>
          )}
          {jobs.items.length > 0 ? (
            <Pager basePath="/admin" noun="articles" params={filterParams(filters)} result={jobs} />
          ) : null}
        </Panel>
      </div>
    </AdminShell>
  );
}
