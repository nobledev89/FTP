import {
  editorialLabel,
  editorialState,
  editorialTone,
  type EditorialInput,
} from "@/lib/admin/editorial-status";

import { StatusBadge } from "./status-badge";

/**
 * The editor-facing status: one of six plain labels. The exact database status is kept in the
 * accessible name and in Technical details, so nothing is hidden from an operator.
 */
export function EditorialBadge(props: EditorialInput) {
  const state = editorialState(props);
  return (
    <span title={props.status}>
      <StatusBadge tone={editorialTone(state)}>{editorialLabel(state)}</StatusBadge>
    </span>
  );
}
