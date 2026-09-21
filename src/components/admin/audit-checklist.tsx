import type { AuditSummary } from "@/lib/admin/jobs";
import { auditFindingSchema } from "@/lib/validation/artifacts";

import { StatusBadge, type StatusTone } from "./status-badge";

/**
 * The latest audit as an editor reads it: the verdict in words, the auditor's summary, and each
 * finding as a note with what is wrong and what to do about it. The raw JSON of every audit stays
 * under Technical details.
 */

type Finding = ReturnType<typeof auditFindingSchema.parse>;

const CATEGORY_LABELS = {
  facts: "Facts",
  support: "Evidence",
  contradiction: "Contradiction",
  source_quality: "Sources",
  wording_overlap: "Wording overlap",
  ai_style: "Style",
  repetition: "Repetition",
  grammar: "Grammar",
  clarity: "Clarity",
  seo: "SEO",
  structure: "Structure",
  usefulness: "Usefulness",
  internal_consistency: "Consistency",
  staleness: "Out of date",
  jurisdiction: "UK relevance",
  risk_context: "Risk context",
} as const satisfies Record<Finding["category"], string>;

const SEVERITY = {
  critical: { label: "Critical", tone: "danger" },
  major: { label: "Major", tone: "warning" },
  minor: { label: "Minor", tone: "neutral" },
} as const satisfies Record<Finding["severity"], { label: string; tone: StatusTone }>;

const SEVERITY_ORDER: Record<Finding["severity"], number> = { critical: 0, major: 1, minor: 2 };

const VERDICTS = {
  PASS: { label: "Passed", tone: "success" },
  REVISION_REQUIRED: { label: "Asked for changes", tone: "warning" },
  NEEDS_HUMAN: { label: "Needs an editor", tone: "danger" },
} as const satisfies Record<AuditSummary["verdict"], { label: string; tone: StatusTone }>;

export function AuditChecklist({ audit }: { audit: AuditSummary | undefined }) {
  if (!audit) {
    return (
      <p className="text-sm text-text-muted">
        The check runs after the draft and image are ready. It reviews facts, sources, and style.
      </p>
    );
  }

  const findings = audit.findings
    .map((finding) => auditFindingSchema.safeParse(finding))
    .flatMap((result) => (result.success ? [result.data] : []))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const unreadable = audit.findings.length - findings.length;
  const verdict = VERDICTS[audit.verdict];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={verdict.tone}>{verdict.label}</StatusBadge>
        <span className="text-xs text-text-subtle">
          {findings.length === 0
            ? "No notes"
            : `${findings.length} note${findings.length === 1 ? "" : "s"}`}
          {audit.cycle > 0 ? ` · after ${audit.cycle} rewrite${audit.cycle === 1 ? "" : "s"}` : ""}
        </span>
      </div>
      {audit.summary ? <p className="text-sm leading-6">{audit.summary}</p> : null}
      {findings.length > 0 ? (
        <ul className="grid gap-2">
          {findings.map((finding, index) => (
            <li className="rounded-control border border-border bg-canvas p-2.5" key={index}>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge tone={SEVERITY[finding.severity].tone}>
                  {SEVERITY[finding.severity].label}
                </StatusBadge>
                <span className="text-xs font-medium">{CATEGORY_LABELS[finding.category]}</span>
              </div>
              <p className="mt-1.5 text-sm">{finding.problem}</p>
              <p className="mt-1 text-xs text-text-muted">
                <span className="font-medium">Suggested fix:</span> {finding.recommendedCorrection}
              </p>
              <p className="mt-1 text-[11px] text-text-subtle">{finding.location}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {unreadable > 0 ? (
        <p className="text-xs text-text-subtle">
          {unreadable} older note{unreadable === 1 ? " is" : "s are"} shown under Technical details.
        </p>
      ) : null}
    </div>
  );
}
