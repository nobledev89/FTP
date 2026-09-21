import { stepTracker, type StepState, type StepTrackerInput } from "@/lib/admin/editorial-status";

/**
 * Research → Write → Image → Check → Publish, with where the job is now. Each step names its state
 * in text for screen readers; the colour and marker only reinforce it.
 */

const STATE_TEXT = {
  done: "done",
  current: "in progress",
  blocked: "stopped here",
  upcoming: "not started",
  skipped: "skipped",
} as const satisfies Record<StepState, string>;

const MARKER_CLASSES = {
  done: "border-success bg-success text-white",
  current: "border-info bg-info-bg text-info",
  blocked: "border-danger bg-danger-bg text-danger",
  upcoming: "border-border-strong bg-panel text-text-subtle",
  skipped: "border-dashed border-border-strong bg-panel text-text-subtle",
} as const satisfies Record<StepState, string>;

const LABEL_CLASSES = {
  done: "text-text",
  current: "font-semibold text-info",
  blocked: "font-semibold text-danger",
  upcoming: "text-text-subtle",
  skipped: "text-text-subtle line-through",
} as const satisfies Record<StepState, string>;

export function StepTracker({
  compact = false,
  ...input
}: StepTrackerInput & { compact?: boolean }) {
  const steps = stepTracker(input);
  if (steps.length === 0) return null;

  return (
    <ol aria-label="Progress" className="flex flex-wrap items-center gap-x-1 gap-y-2">
      {steps.map((step, index) => (
        <li className="flex items-center gap-1" key={step.step}>
          {index > 0 ? (
            <span
              aria-hidden="true"
              className={`h-px ${compact ? "w-2" : "w-4 sm:w-6"} ${
                step.state === "done" || step.state === "current" || step.state === "blocked"
                  ? "bg-success"
                  : "bg-border"
              }`}
            />
          ) : null}
          <span
            aria-hidden="true"
            className={`flex ${compact ? "size-3.5 text-[8px]" : "size-5 text-[10px]"} shrink-0 items-center justify-center rounded-full border font-semibold ${MARKER_CLASSES[step.state]}`}
          >
            {step.state === "done" ? "✓" : step.state === "blocked" ? "!" : ""}
          </span>
          <span className={`${compact ? "text-[11px]" : "text-xs"} ${LABEL_CLASSES[step.state]}`}>
            {step.label}
            <span className="sr-only">: {STATE_TEXT[step.state]}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
