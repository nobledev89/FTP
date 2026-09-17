import type { Metadata } from "next";
import Link from "next/link";

import { AdminShell } from "@/components/admin/admin-shell";
import { Cell, Table, TableHead, TableRow } from "@/components/admin/data-table";
import { EmptyState, Notice, Panel } from "@/components/admin/panel";
import { StatusBadge } from "@/components/admin/status-badge";
import { getPromptTemplateContent, listPromptTemplates } from "@/lib/admin/configuration";
import { formatCount, formatDateTime } from "@/lib/admin/format";
import { requireAdminSession } from "@/lib/auth/dal";

export const metadata: Metadata = {
  title: "Prompts",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type PromptsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PromptsPage({ searchParams }: PromptsPageProps) {
  const session = await requireAdminSession();
  const params = await searchParams;
  const previewId = Array.isArray(params.preview) ? params.preview[0] : params.preview;

  const [grouped, preview] = await Promise.all([
    listPromptTemplates(session.siteId),
    previewId ? getPromptTemplateContent(session.siteId, previewId) : Promise.resolve(null),
  ]);

  const keys = [...grouped.keys()];

  return (
    <AdminShell currentHref="/admin/prompts" session={session} title="Prompts">
      <div className="grid gap-4">
        <Notice tone="info">
          Prompt versions are immutable: activation is the only mutable state, and history is never
          rewritten. Seeding the templates and the editorial style guide, and activating or rolling
          back a version, arrive with the mock pipeline in Phase 6. This page reads what is stored
          today.
        </Notice>

        {keys.length === 0 ? (
          <Panel title="Prompt templates">
            <EmptyState>
              No prompt template has been stored yet. Phase 6 seeds{" "}
              <span className="font-mono">editorial-style</span>,{" "}
              <span className="font-mono">research</span>, <span className="font-mono">draft</span>,{" "}
              <span className="font-mono">image-brief</span>,{" "}
              <span className="font-mono">audit</span>, and{" "}
              <span className="font-mono">revise</span>.
            </EmptyState>
          </Panel>
        ) : (
          keys.map((key) => {
            const versions = grouped.get(key) ?? [];
            const active = versions.find((version) => version.isActive);
            return (
              <Panel
                description={
                  active
                    ? `Active: version ${active.version}, created ${formatDateTime(active.createdAt)}.`
                    : "No version is active for this key."
                }
                flush
                key={key}
                title={key}
              >
                <Table minWidth="36rem">
                  <TableHead columns={["Version", "State", "Size", "Notes", "Created", ""]} />
                  <tbody>
                    {versions.map((version) => (
                      <TableRow key={version.id}>
                        <Cell variant="mono">v{version.version}</Cell>
                        <Cell>
                          {version.isActive ? (
                            <StatusBadge tone="success">active</StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral">inactive</StatusBadge>
                          )}
                        </Cell>
                        <Cell nowrap variant="mono">
                          {formatCount(version.characters)} chars
                        </Cell>
                        <Cell variant="muted">{version.notes ?? "—"}</Cell>
                        <Cell nowrap variant="mono">
                          {formatDateTime(version.createdAt)}
                        </Cell>
                        <Cell nowrap>
                          <Link
                            className="text-accent hover:underline"
                            href={`/admin/prompts?preview=${version.id}`}
                          >
                            Preview
                          </Link>
                        </Cell>
                      </TableRow>
                    ))}
                  </tbody>
                </Table>
              </Panel>
            );
          })
        )}

        {preview ? (
          <Panel
            actions={
              <Link className="text-xs text-accent hover:underline" href="/admin/prompts">
                Close preview
              </Link>
            }
            title={`${preview.key} v${preview.version}`}
          >
            <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-control border border-border bg-canvas p-3 font-mono text-[11px] leading-relaxed">
              {preview.content}
            </pre>
          </Panel>
        ) : null}
      </div>
    </AdminShell>
  );
}
