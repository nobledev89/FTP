import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { Cell, Table, TableHead, TableRow } from "@/components/admin/data-table";
import { EmptyState, Notice, Panel } from "@/components/admin/panel";
import { ProviderSettingForm } from "@/components/admin/provider-setting-form";
import { StatusBadge } from "@/components/admin/status-badge";
import { listProviderSettings, listWorkerInstances } from "@/lib/admin/configuration";
import { formatDateTime, formatRelativeTime } from "@/lib/admin/format";
import { isBillableMode, providerModeLabel, stageLabel } from "@/lib/admin/status-display";
import { requireAdminSession } from "@/lib/auth/dal";
import { PIPELINE_STAGES } from "@/lib/state-machine/transitions";

export const metadata: Metadata = {
  title: "Providers",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Where each mode actually executes, so the cost and prerequisite are never a surprise. */
const MODE_NOTES: Readonly<Record<string, string>> = {
  mock: "Deterministic fixtures. No provider, no cost.",
  manual_chatgpt: "You paste the prompt into ChatGPT and paste the result back. Subscription.",
  manual_claude: "You paste the prompt into Claude and paste the result back. Subscription.",
  manual_gemini: "You generate the image in Gemini and upload it. Subscription.",
  codex_cli: "Runs the Codex CLI on the worker PC using its existing sign-in. Subscription.",
  claude_code:
    "Runs the Claude Code CLI on the worker PC using its existing sign-in. Subscription.",
  openai_api: "Metered OpenAI API calls. Billed per request.",
  anthropic_api: "Metered Anthropic API calls. Billed per request.",
  gemini_api: "Metered Gemini API calls. Billed per request.",
  internal: "Handled by the worker itself. No external provider.",
};

export default async function ProvidersPage() {
  const session = await requireAdminSession();
  const [settings, workers] = await Promise.all([
    listProviderSettings(session.siteId),
    listWorkerInstances(),
  ]);

  const byStage = new Map(settings.map((setting) => [setting.stage, setting]));
  const billable = settings.filter((setting) => isBillableMode(setting.mode));

  return (
    <AdminShell currentHref="/admin/providers" session={session} title="Providers">
      <div className="grid gap-4">
        <Notice tone="info">
          Providers run on the owner&rsquo;s PC, never in this application: the publication has no
          inbound connection to it and holds no provider credentials. Manual modes prepare a prompt
          on the worker and wait here without holding a queue lease. CLI and API choices remain
          unavailable until their adapters and safety checks are implemented.
        </Notice>

        {billable.length > 0 ? (
          <Notice tone="warning">
            {billable.length} stage{billable.length === 1 ? " is" : "s are"} set to a metered API
            mode:{" "}
            {billable
              .map((setting) => `${stageLabel(setting.stage)} (${providerModeLabel(setting.mode)})`)
              .join(", ")}
            . These calls are charged by the provider on every run.
          </Notice>
        ) : (
          <Notice tone="success">
            No stage uses a metered API mode. Version 1 runs entirely on mock, manual, and
            subscription CLI providers.
          </Notice>
        )}

        <Panel
          description="These defaults apply only to newly created jobs; every job keeps its own mode snapshot."
          title="Editable defaults"
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {(["research", "draft", "images", "audit"] as const).map((stage) => (
              <ProviderSettingForm
                canEdit={session.canEdit}
                currentMode={byStage.get(stage)?.mode ?? "mock"}
                key={stage}
                stage={stage}
              />
            ))}
          </div>
        </Panel>

        <Panel description="One mode per worker stage, per publication." flush title="Stage modes">
          {settings.length === 0 ? (
            <div className="p-4">
              <EmptyState>No provider settings are stored.</EmptyState>
            </div>
          ) : (
            <Table>
              <TableHead columns={["Stage", "Mode", "Cost", "What it does", "Updated"]} />
              <tbody>
                {PIPELINE_STAGES.map((stage) => {
                  const setting = byStage.get(stage);
                  if (!setting) {
                    return (
                      <TableRow key={stage}>
                        <Cell variant="strong">{stageLabel(stage)}</Cell>
                        <Cell variant="muted">Not configured</Cell>
                        <Cell variant="muted">—</Cell>
                        <Cell variant="muted">Falls back to mock when a job is created.</Cell>
                        <Cell variant="muted">—</Cell>
                      </TableRow>
                    );
                  }
                  return (
                    <TableRow key={stage}>
                      <Cell variant="strong">{stageLabel(stage)}</Cell>
                      <Cell>
                        <span className="font-mono text-xs">{setting.mode}</span>
                      </Cell>
                      <Cell nowrap>
                        {isBillableMode(setting.mode) ? (
                          <StatusBadge tone="warning">billed</StatusBadge>
                        ) : (
                          <StatusBadge tone="success">no cost</StatusBadge>
                        )}
                      </Cell>
                      <Cell variant="muted">{MODE_NOTES[setting.mode] ?? "—"}</Cell>
                      <Cell nowrap variant="mono">
                        {formatDateTime(setting.updated_at)}
                      </Cell>
                    </TableRow>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel
          description="A stage only runs when a worker with that capability is online."
          flush
          title="Worker capability"
        >
          {workers.length === 0 ? (
            <div className="p-4">
              <EmptyState>
                No worker has reported in. Subscription CLI and manual modes need the local worker
                running on the owner&rsquo;s PC.
              </EmptyState>
            </div>
          ) : (
            <Table minWidth="36rem">
              <TableHead columns={["Worker", "Host", "Version", "Current stage", "Last seen"]} />
              <tbody>
                {workers.map((worker) => (
                  <TableRow key={worker.worker_id}>
                    <Cell variant="mono">{worker.worker_id}</Cell>
                    <Cell variant="muted">{worker.host_label ?? "—"}</Cell>
                    <Cell variant="mono">{worker.version ?? "—"}</Cell>
                    <Cell variant="muted">
                      {worker.current_stage ? stageLabel(worker.current_stage) : "Idle"}
                    </Cell>
                    <Cell nowrap variant="mono">
                      {formatRelativeTime(worker.last_seen_at)}
                    </Cell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>
    </AdminShell>
  );
}
