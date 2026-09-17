import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { DefinitionList, Notice, Panel } from "@/components/admin/panel";
import { SiteIdentityForm, SiteSettingsForm } from "@/components/admin/settings-forms";
import { getPublicationConfiguration } from "@/lib/admin/configuration";
import { formatDateTime } from "@/lib/admin/format";
import { requireAdminSession } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireAdminSession();
  const configuration = await getPublicationConfiguration(session.siteId);

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
