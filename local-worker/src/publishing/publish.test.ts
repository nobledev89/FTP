import { describe, expect, it } from "vitest";

import { publicImagePath } from "./publish.js";

describe("publicImagePath", () => {
  it("keeps the working file name so a repeated publish overwrites the same object", () => {
    const first = publicImagePath("open-banking-rules", "jobs/abc/images/hero-v1.png", 0);
    const second = publicImagePath("open-banking-rules", "jobs/abc/images/hero-v1.png", 0);
    expect(first).toBe("articles/open-banking-rules/hero-v1.png");
    expect(second).toBe(first);
  });

  it("gives each slot its own object", () => {
    expect(publicImagePath("slug", "jobs/abc/images/slot-1-v2.png", 1)).toBe(
      "articles/slug/slot-1-v2.png",
    );
  });

  it("constrains a surprising working path to a key publish_article will accept", () => {
    expect(publicImagePath("slug", "jobs/abc/images/../../secret file.png", 0)).toBe(
      "articles/slug/secret-file.png",
    );
    expect(publicImagePath("slug", "jobs/abc/images/", 2)).toBe("articles/slug/slot-2");
    expect(publicImagePath("slug", "", 3)).toBe("articles/slug/slot-3");
  });

  it("always produces a path inside the articles prefix the database requires", () => {
    for (const path of ["a/b.png", "..", "/", "x/../../y.png", "  .png"]) {
      expect(publicImagePath("slug", path, 0)).toMatch(/^articles\/slug\/[A-Za-z0-9._-]+$/);
    }
  });
});
