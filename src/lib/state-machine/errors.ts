export type WorkflowErrorCode =
  | "INVALID_TRANSITION"
  | "STALE_JOB"
  | "LEASE_LOST"
  | "IMMUTABLE_HISTORY"
  | "GATE_NOT_MET"
  | "SLUG_CONFLICT"
  | "NOT_AUTHORIZED"
  | "NOT_FOUND"
  | "INVALID_ARGUMENT"
  | "DATABASE_ERROR";

const SQLSTATE_TO_WORKFLOW_ERROR = {
  FT001: "INVALID_TRANSITION",
  FT002: "STALE_JOB",
  FT003: "LEASE_LOST",
  FT004: "IMMUTABLE_HISTORY",
  FT005: "GATE_NOT_MET",
  FT006: "SLUG_CONFLICT",
  "42501": "NOT_AUTHORIZED",
  P0002: "NOT_FOUND",
  "22023": "INVALID_ARGUMENT",
} as const satisfies Record<string, WorkflowErrorCode>;

export type DatabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;
  readonly sqlState?: string;
  readonly details?: string;
  readonly hint?: string;

  constructor(
    code: WorkflowErrorCode,
    message: string,
    options: { sqlState?: string; details?: string; hint?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "WorkflowError";
    this.code = code;
    this.sqlState = options.sqlState;
    this.details = options.details;
    this.hint = options.hint;
  }
}

export function toWorkflowError(error: unknown): WorkflowError {
  if (error instanceof WorkflowError) return error;

  if (error && typeof error === "object") {
    const databaseError = error as DatabaseErrorLike;
    const sqlState = databaseError.code;
    const code = sqlState
      ? (SQLSTATE_TO_WORKFLOW_ERROR[sqlState as keyof typeof SQLSTATE_TO_WORKFLOW_ERROR] ??
        "DATABASE_ERROR")
      : "DATABASE_ERROR";
    return new WorkflowError(code, databaseError.message ?? "The workflow request failed", {
      ...(sqlState ? { sqlState } : {}),
      ...(databaseError.details ? { details: databaseError.details } : {}),
      ...(databaseError.hint ? { hint: databaseError.hint } : {}),
      cause: error,
    });
  }

  return new WorkflowError("DATABASE_ERROR", "The workflow request failed", { cause: error });
}
