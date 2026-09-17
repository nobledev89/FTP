export type VersionedArtifactKind = "research" | "draft" | "audit" | "image";

export class ArtifactVersionConflictError extends Error {
  readonly kind: VersionedArtifactKind;
  readonly expectedLatestVersion: number;
  readonly actualLatestVersion: number;

  constructor(
    kind: VersionedArtifactKind,
    expectedLatestVersion: number,
    actualLatestVersion: number,
    options: { cause?: unknown } = {},
  ) {
    super(
      `${kind} artifact changed since it was loaded (${expectedLatestVersion} !== ${actualLatestVersion})`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ArtifactVersionConflictError";
    this.kind = kind;
    this.expectedLatestVersion = expectedLatestVersion;
    this.actualLatestVersion = actualLatestVersion;
  }
}

export function nextArtifactVersion(
  kind: VersionedArtifactKind,
  actualLatestVersion: number,
  expectedLatestVersion: number = actualLatestVersion,
): number {
  if (!Number.isInteger(actualLatestVersion) || actualLatestVersion < 0) {
    throw new RangeError("actual latest artifact version must be a non-negative integer");
  }
  if (!Number.isInteger(expectedLatestVersion) || expectedLatestVersion < 0) {
    throw new RangeError("expected latest artifact version must be a non-negative integer");
  }
  if (actualLatestVersion !== expectedLatestVersion) {
    throw new ArtifactVersionConflictError(kind, expectedLatestVersion, actualLatestVersion);
  }
  return actualLatestVersion + 1;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}
