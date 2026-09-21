import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AdminShell } from "@/components/admin/admin-shell";
import { StatusBadge, type StatusTone } from "@/components/admin/status-badge";
import { designReviewEnabled } from "@/lib/site/config";

export const metadata: Metadata = {
  title: "Admin token sheet",
};

const colourTokens = [
  ["canvas", "bg-canvas", "#fafafa"],
  ["panel", "bg-panel", "#ffffff"],
  ["border", "bg-border", "#e4e4e7"],
  ["border-strong", "bg-border-strong", "#71717a"],
  ["text", "bg-text", "#18181b"],
  ["text-muted", "bg-text-muted", "#52525b"],
  ["text-subtle", "bg-text-subtle", "#71717a"],
  ["accent", "bg-accent", "#1d4ed8"],
] as const;

const sampleStatuses: ReadonlyArray<[string, StatusTone]> = [
  ["VERIFIED", "success"],
  ["PUBLISHED", "success"],
  ["DRAFTING", "info"],
  ["AUDITING", "info"],
  ["SCHEDULED", "warning"],
  ["Awaiting input", "warning"],
  ["PAUSED", "neutral"],
  ["IDEA", "neutral"],
  ["NEEDS_HUMAN", "danger"],
  ["FAILED", "danger"],
];

const sampleJobs = [
  {
    id: "7f3c9a1e",
    topic: "Account-to-account payments at checkout",
    status: ["AUDITING", "info"],
    stage: "Audit · cycle 1",
    updated: "17 Sept 2026 09:14",
  },
  {
    id: "1b8d44c0",
    topic: "Savings rates after a base rate decision",
    status: ["Awaiting input", "warning"],
    stage: "Research · manual ChatGPT",
    updated: "17 Sept 2026 08:52",
  },
  {
    id: "c02e7b19",
    topic: "Buy now, pay later affordability checks",
    status: ["NEEDS_HUMAN", "danger"],
    stage: "Draft · Claude Code auth expired",
    updated: "16 Sept 2026 22:03",
  },
  {
    id: "9ad1f6e2",
    topic: "Card surcharges explained",
    status: ["VERIFIED", "success"],
    stage: "Verified · 8/8 checks",
    updated: "16 Sept 2026 18:40",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  topic: string;
  status: readonly [string, StatusTone];
  stage: string;
  updated: string;
}>;

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-panel border border-border bg-panel">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">{title}</h2>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function AdminTokenSheetPage() {
  if (!designReviewEnabled()) {
    notFound();
  }

  return (
    <AdminShell
      actions={
        <span className="hidden items-center gap-2 text-xs text-text-muted sm:flex">
          <span aria-hidden="true" className="size-2 rounded-full bg-success" />
          Worker online · 12s ago
        </span>
      }
      currentHref="/admin"
      title="Admin token sheet"
    >
      <p className="mb-4 rounded-panel border border-warning/25 bg-warning-bg px-3 py-2 text-xs text-warning">
        Design review fixture. Sample data only; not connected to the database.
      </p>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Colour tokens">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {colourTokens.map(([name, swatch, hex]) => (
              <li key={name}>
                <div className={`h-10 rounded-control border border-border ${swatch}`} />
                <div className="mt-1.5 text-xs font-medium">{name}</div>
                <div className="font-mono text-[11px] text-text-subtle">{hex}</div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Status badges">
          <ul className="flex flex-wrap gap-2">
            {sampleStatuses.map(([label, tone]) => (
              <li key={label}>
                <StatusBadge tone={tone}>{label}</StatusBadge>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-text-muted">
            Colour reinforces the text label and never carries meaning on its own.
          </p>
        </Panel>

        <Panel title="Typography">
          <div className="space-y-2">
            <p className="text-xl font-semibold">Page title 20px semibold</p>
            <p className="text-base font-semibold">Section title 16px semibold</p>
            <p className="text-sm">Body 14px regular for descriptions and form help.</p>
            <p className="text-[13px] text-text-muted">Table text 13px muted</p>
            <p className="text-xs font-medium uppercase tracking-wide text-text-subtle">
              Label 12px
            </p>
            <p className="font-mono text-xs text-text-muted">job 7f3c9a1e · draft v3 · 00:01:42</p>
          </div>
        </Panel>

        <Panel title="Controls">
          <form className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-medium text-text-muted">
              Topic
              <input
                className="h-8 rounded-control border border-border-strong bg-panel px-2 text-sm text-text"
                defaultValue="Account-to-account payments"
                name="topic"
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-text-muted">
              Research provider
              <select
                className="h-8 rounded-control border border-border-strong bg-panel px-2 text-sm text-text"
                defaultValue="manual_chatgpt"
                name="provider"
              >
                <option value="mock">Mock</option>
                <option value="manual_chatgpt">Manual ChatGPT</option>
                <option value="codex_cli">Codex CLI</option>
                <option value="openai_api">OpenAI API (billed)</option>
              </select>
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button
                className="h-8 rounded-control bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover"
                type="button"
              >
                Create job
              </button>
              <button
                className="h-8 rounded-control border border-border-strong bg-panel px-3 text-sm font-medium hover:bg-neutral-bg"
                type="button"
              >
                Pause
              </button>
              <button
                className="h-8 rounded-control border border-danger/40 bg-panel px-3 text-sm font-medium text-danger hover:bg-danger-bg"
                type="button"
              >
                Mark needs human
              </button>
            </div>
          </form>
        </Panel>
      </div>

      <section className="mt-4 overflow-hidden rounded-panel border border-border bg-panel">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Dense table</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-[13px]">
            <thead className="border-b border-border bg-canvas text-xs text-text-muted">
              <tr>
                <th className="h-9 px-4 font-medium" scope="col">
                  Job
                </th>
                <th className="h-9 px-4 font-medium" scope="col">
                  Topic
                </th>
                <th className="h-9 px-4 font-medium" scope="col">
                  Status
                </th>
                <th className="h-9 px-4 font-medium" scope="col">
                  Stage
                </th>
                <th className="h-9 px-4 font-medium" scope="col">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody>
              {sampleJobs.map((job) => (
                <tr className="border-b border-border last:border-0 hover:bg-canvas" key={job.id}>
                  <td className="h-9 px-4 font-mono text-xs text-text-muted">{job.id}</td>
                  <td className="h-9 px-4 font-medium">{job.topic}</td>
                  <td className="h-9 px-4">
                    <StatusBadge tone={job.status[1]}>{job.status[0]}</StatusBadge>
                  </td>
                  <td className="h-9 px-4 text-text-muted">{job.stage}</td>
                  <td className="h-9 whitespace-nowrap px-4 font-mono text-xs text-text-subtle">
                    {job.updated}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-4 rounded-panel border border-border bg-panel">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Timeline</h2>
        <ol className="p-4">
          {[
            ["09:14:02", "AUDIT_PENDING → AUDITING", "worker home-pc-1 claimed stage"],
            ["09:13:40", "IMAGES_PROCESSING → AUDIT_PENDING", "2 of 2 images complete"],
            ["08:58:11", "DRAFTING → DRAFT_COMPLETE", "draft v1 saved · claude_code"],
          ].map(([time, transition, detail]) => (
            <li className="relative border-l border-border pb-4 pl-4 last:pb-0" key={time}>
              <span
                aria-hidden="true"
                className="absolute -left-[4.5px] top-1.5 size-2 rounded-full border border-border-strong bg-panel"
              />
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-mono text-xs text-text-subtle">{time}</span>
                <span className="font-mono text-xs font-medium">{transition}</span>
              </div>
              <p className="mt-0.5 text-xs text-text-muted">{detail}</p>
            </li>
          ))}
        </ol>
      </section>
    </AdminShell>
  );
}
