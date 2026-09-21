import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { Cell, Table, TableHead, TableRow } from "@/components/admin/data-table";
import { DiscoverySettingsForm } from "@/components/admin/discovery-settings-form";
import { DefinitionList, EmptyState, Notice, Panel } from "@/components/admin/panel";
import { StatusBadge } from "@/components/admin/status-badge";
import { SiteIdentityForm, SiteSettingsForm } from "@/components/admin/settings-forms";
import { getPublicationConfiguration } from "@/lib/admin/configuration";
import { getDiscoveryOverview } from "@/lib/admin/discovery";
import { formatDateTime, formatElapsed } from "@/lib/admin/format";
import { requireAdminSession } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireAdminSession();
  const [configuration, discovery] = await Promise.all([
    getPublicationConfiguration(session.siteId),
    getDiscoveryOverview(session.siteId),
  ]);

  if (!configuration) {
    return (
      <AdminShell currentHref="/admin/settings" session={session} title="Settings">
        <Notice tone="danger">
          No site row was found for this membership. Run the seed (
          <span className="font-mono">pnpm supabase:reset</span> locally) or check that the hosted
          project was set up as described in docs/SUPABASE.md.
        </Notice>
      </AdminShell>
    );
  }

  const { site, settings } = configuration;

  return (
    <AdminShell currentHref="/admin/settings" session={session} title="Settings">
      <div className="grid gap-4">
        <Panel
          description="Values the deployment owns. Changing these is a migration and redeployment, not a settings edit."
          title="Deployment"
        >
          <DefinitionList
            columns={3}
            items={[
              [
                "Slug",
                <span className="font-mono" key="slug">
                  {site.slug}
                </span>,
              ],
              [
                "Canonical origin",
                <span className="font-mono" key="origin">
                  {site.canonical_origin}
                </span>,
              ],
              [
                "Locale",
                <span className="font-mono" key="locale">
                  {site.locale}
                </span>,
              ],
              [
                "Currency",
                <span className="font-mono" key="currency">
                  {site.currency}
                </span>,
              ],
              ["Settings updated", formatDateTime(settings.updated_at)],
              ["Identity updated", formatDateTime(site.updated_at)],
            ]}
          />
          <p className="mt-3 text-xs text-text-muted">
            The canonical origin is stored on every published article&rsquo;s canonical URL, so it
            is fixed after the first publication.
          </p>
        </Panel>

        <Panel
          description="Name, description, disclosure, and the timezone used for scheduling."
          title="Publication identity"
        >
          <SiteIdentityForm isOwner={session.isOwner} site={site} />
        </Panel>

        {discovery ? (
          <Panel
            description="Finds real, recent news for each category and writes the articles on the worker PC. With automatic publishing on, a finished article goes live by itself when it has an image, is not a repeat, and the day still has room; anything else waits on the dashboard for you."
            title="Topic discovery"
          >
            <DiscoverySettingsForm
              canEdit={session.canEdit}
              categories={discovery.categories.map((category) => ({
                id: category.id,
                name: category.name,
                guidance: category.guidance,
                dailyTarget: category.daily_target,
                createdToday: category.createdToday,
              }))}
              autoPublish={discovery.settings.discovery_auto_publish}
              enabled={discovery.settings.discovery_enabled}
              imageCount={discovery.settings.discovery_image_count}
              intervalMinutes={discovery.settings.discovery_interval_minutes}
              spacingMinutes={discovery.settings.auto_publish_spacing_minutes}
            />
          </Panel>
        ) : null}

        {discovery ? (
          <Panel
            description={`Last scan started ${formatDateTime(discovery.settings.discovery_last_started_at)}. A scan only runs when a category still needs an article today.`}
            flush
            title="Recent scans"
          >
            {discovery.runs.length === 0 ? (
              <div className="p-4">
                <EmptyState>No scan has run yet.</EmptyState>
              </div>
            ) : (
              <Table minWidth="40rem">
                <TableHead
                  columns={["Started", "Status", "Categories", "Found", "Created", "Took", "Note"]}
                />
                <tbody>
                  {discovery.runs.map((run) => (
                    <TableRow key={run.id}>
                      <Cell nowrap variant="mono">
                        {formatDateTime(run.started_at)}
                      </Cell>
                      <Cell>
                        <StatusBadge
                          tone={
                            run.status === "succeeded"
                              ? "success"
                              : run.status === "failed"
                                ? "danger"
                                : "info"
                          }
                        >
                          {run.status}
                        </StatusBadge>
                      </Cell>
                      <Cell variant="muted">{run.categories.join(", ")}</Cell>
                      <Cell variant="mono">{run.candidates ?? "—"}</Cell>
                      <Cell variant="mono">{run.created_job_ids.length}</Cell>
                      <Cell nowrap variant="mono">
                        {formatElapsed(run.started_at, run.finished_at)}
                      </Cell>
                      <Cell variant="muted">{run.error ?? "—"}</Cell>
                    </TableRow>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        ) : null}

        <Panel
          description="Editorial defaults, SEO fallbacks, and worker health thresholds."
          title="Publication settings"
        >
          <SiteSettingsForm canEdit={session.canEdit} settings={settings} />
        </Panel>
      </div>
    </AdminShell>
  );
}
