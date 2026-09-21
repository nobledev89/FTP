import type { Metadata } from "next";
import Link from "next/link";

import { AdminShell } from "@/components/admin/admin-shell";
import { Cell, FilterTabs, Pager, Table, TableHead, TableRow } from "@/components/admin/data-table";
import { LiveRefresh } from "@/components/admin/live-refresh";
import { EmptyState, Notice, Panel } from "@/components/admin/panel";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime, formatElapsed } from "@/lib/admin/format";
import {
  LOG_SOURCE_LABELS,
  LOG_SOURCES,
  listEventLogs,
  listProviderRunLogs,
  listPublishingLogs,
  logFilterParams,
  parseLogFilters,
} from "@/lib/admin/logs";
import { DEFAULT_PAGE_SIZE, parsePage } from "@/lib/admin/pagination";
import {
  errorClassLabel,
  logOutcomeTone,
  providerModeLabel,
  runStatusTone,
  shortId,
  stageLabel,
} from "@/lib/admin/status-display";
import { requireAdminSession } from "@/lib/auth/dal";
import { PIPELINE_STAGES } from "@/lib/state-machine/transitions";

export const metadata: Metadata = {
  title: "Logs",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type LogsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LogsPage({ searchParams }: LogsPageProps) {
  const session = await requireAdminSession();
  const serverUpdatedAt = new Date().toISOString();
  const params = await searchParams;
  const filters = parseLogFilters(params);
  const page = parsePage(params.page);
  const linkParams = logFilterParams(filters);

  const [providerRuns, publishing, events] = await Promise.all([
    filters.source === "provider"
      ? listProviderRunLogs(filters, page, DEFAULT_PAGE_SIZE)
      : Promise.resolve(null),
    filters.source === "publishing"
      ? listPublishingLogs(filters, page, DEFAULT_PAGE_SIZE)
      : Promise.resolve(null),
    filters.source === "events"
      ? listEventLogs(filters, page, DEFAULT_PAGE_SIZE)
      : Promise.resolve(null),
  ]);

  const result = providerRuns ?? publishing ?? events;

  const jobLink = (jobId: string) => (
    <Link className="text-accent hover:underline" href={`/admin/articles/${jobId}`} title={jobId}>
      {shortId(jobId)}
    </Link>
  );

  return (
    <AdminShell
      actions={<LiveRefresh serverUpdatedAt={serverUpdatedAt} />}
      currentHref="/admin/logs"
      session={session}
      title="Logs"
    >
      <div className="grid gap-4">
        <Notice tone="info">
          Messages that originate on the worker PC are redacted before they are shown: credentials,
          local paths, and email addresses are masked, and long output is truncated. The unredacted
          text stays in the database and in the worker&rsquo;s own log.
        </Notice>

        <div className="flex flex-wrap items-center gap-3">
          <FilterTabs
            basePath="/admin/logs"
            current={filters.source}
            label="Log source"
            options={LOG_SOURCES.map((source) => [source, LOG_SOURCE_LABELS[source]] as const)}
            paramName="source"
            params={linkParams}
          />
          <FilterTabs
            basePath="/admin/logs"
            current={filters.failuresOnly ? "1" : ""}
            label="Failures"
            options={[
              ["", "All outcomes"],
              ["1", "Failures only"],
            ]}
            paramName="failures"
            params={linkParams}
          />
          {filters.source === "provider" ? (
            <FilterTabs
              basePath="/admin/logs"
              current={filters.stage ?? ""}
              label="Stage"
              options={[
                ["", "All stages"],
                ...PIPELINE_STAGES.map((stage) => [stage, stageLabel(stage)] as const),
              ]}
              paramName="stage"
              params={linkParams}
            />
          ) : null}
        </div>

        {filters.jobId ? (
          <Notice tone="info">
            Filtered to job <span className="font-mono">{shortId(filters.jobId)}</span>.{" "}
            <Link className="font-medium underline" href={`/admin/logs?source=${filters.source}`}>
              Clear
            </Link>
          </Notice>
        ) : null}

        <Panel flush title={LOG_SOURCE_LABELS[filters.source]}>
          {!result || result.items.length === 0 ? (
            <div className="p-4">
              <EmptyState>No entries match this filter.</EmptyState>
            </div>
          ) : providerRuns ? (
            <Table>
              <TableHead
                columns={[
                  "Started",
                  "Job",
                  "Stage",
                  "Mode",
                  "Status",
                  "Error",
                  "Elapsed",
                  "Worker",
                ]}
              />
              <tbody>
                {providerRuns.items.map((run) => (
                  <TableRow key={run.id}>
                    <Cell nowrap variant="mono">
                      {formatDateTime(run.started_at)}
                    </Cell>
                    <Cell variant="mono">{jobLink(run.job_id)}</Cell>
                    <Cell variant="strong">{stageLabel(run.stage)}</Cell>
                    <Cell variant="muted">{providerModeLabel(run.mode)}</Cell>
                    <Cell>
                      <StatusBadge tone={runStatusTone(run.status)}>{run.status}</StatusBadge>
                    </Cell>
                    <Cell variant="muted">
                      {run.error_class ? (
                        <>
                          <span className="font-medium">{errorClassLabel(run.error_class)}</span>
                          {run.error_summary ? ` — ${run.error_summary}` : ""}
                        </>
                      ) : (
                        "—"
                      )}
                    </Cell>
                    <Cell nowrap variant="mono">
                      {formatElapsed(run.started_at, run.finished_at)}
                    </Cell>
                    <Cell variant="mono">{run.worker_id ?? "—"}</Cell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          ) : publishing ? (
            <Table>
              <TableHead
                columns={["When", "Job", "Kind", "Check", "Outcome", "HTTP", "Error", "Worker"]}
              />
              <tbody>
                {publishing.items.map((log) => (
                  <TableRow key={log.id}>
                    <Cell nowrap variant="mono">
                      {formatDateTime(log.created_at)}
                    </Cell>
                    <Cell variant="mono">{jobLink(log.job_id)}</Cell>
                    <Cell variant="strong">{log.kind}</Cell>
                    <Cell variant="mono">{log.check_name ?? "—"}</Cell>
                    <Cell>
                      <StatusBadge tone={logOutcomeTone(log.outcome)}>{log.outcome}</StatusBadge>
                    </Cell>
                    <Cell variant="mono">{log.http_status ?? "—"}</Cell>
                    <Cell variant="muted">{log.error ?? "—"}</Cell>
                    <Cell variant="mono">{log.worker_id ?? "—"}</Cell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          ) : events ? (
            <Table>
              <TableHead columns={["When", "Job", "Event", "Transition", "Actor", "Note"]} />
              <tbody>
                {events.items.map((event) => (
                  <TableRow key={event.id}>
                    <Cell nowrap variant="mono">
                      {formatDateTime(event.created_at)}
                    </Cell>
                    <Cell variant="mono">{jobLink(event.job_id)}</Cell>
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
          ) : null}
          {result ? (
            <Pager basePath="/admin/logs" noun="entries" params={linkParams} result={result} />
          ) : null}
        </Panel>
      </div>
    </AdminShell>
  );
}
