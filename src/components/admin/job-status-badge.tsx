import { jobStatusTone } from "@/lib/admin/status-display";
import type { JobStatus } from "@/lib/state-machine/transitions";

import { StatusBadge } from "./status-badge";

/** The status is always shown as its exact database value; the tone only reinforces it. */
export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <StatusBadge tone={jobStatusTone(status)}>{status}</StatusBadge>;
}
