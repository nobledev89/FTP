import { describe, expect, it } from "vitest";

import {
  ArtifactVersionConflictError,
  isUniqueConstraintError,
  nextArtifactVersion,
} from "./versioning";

describe("artifact version allocation", () => {
  it("starts at one and increments the expected latest version", () => {
    expect(nextArtifactVersion("research", 0)).toBe(1);
    expect(nextArtifactVersion("draft", 7, 7)).toBe(8);
  });

  it("rejects stale writers before insert", () => {
    expect(() => nextArtifactVersion("audit", 3, 2)).toThrow(ArtifactVersionConflictError);
    try {
      nextArtifactVersion("audit", 3, 2);
    } catch (error) {
      expect(error).toMatchObject({
        kind: "audit",
        expectedLatestVersion: 2,
        actualLatestVersion: 3,
      });
    }
  });

  it("rejects invalid version counters and recognizes database races", () => {
    expect(() => nextArtifactVersion("image", -1)).toThrow(RangeError);
    expect(() => nextArtifactVersion("image", 1.5)).toThrow(RangeError);
    expect(isUniqueConstraintError({ code: "23505" })).toBe(true);
    expect(isUniqueConstraintError({ code: "FT002" })).toBe(false);
  });
});
