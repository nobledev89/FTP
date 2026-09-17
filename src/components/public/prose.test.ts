import { describe, expect, it } from "vitest";

import { isCurrentSection } from "./nav-links";
import { resolveProseLink } from "./prose";

describe("resolveProseLink", () => {
  it("allows http(s), root-relative, and fragment links", () => {
    expect(resolveProseLink("https://www.fca.org.uk/")).toEqual({
      href: "https://www.fca.org.uk/",
      external: true,
    });
    expect(resolveProseLink("http://example.com/a?b=1")).toEqual({
      href: "http://example.com/a?b=1",
      external: true,
    });
    expect(resolveProseLink("/blog/some-slug")).toEqual({
      href: "/blog/some-slug",
      external: false,
    });
    expect(resolveProseLink("#sources")).toEqual({ href: "#sources", external: false });
  });

  it("refuses script, data, protocol-relative, and malformed links", () => {
    for (const href of [
      "javascript:alert(1)",
      " JAVASCRIPT:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
      "//evil.example/path",
      "relative/path",
      "mailto:someone@example.com",
      "",
      undefined,
    ]) {
      expect(resolveProseLink(href), String(href)).toBeNull();
    }
  });
});

describe("isCurrentSection", () => {
  it("matches the section and its descendants but not prefixes of other words", () => {
    expect(isCurrentSection("/blog", "/blog")).toBe(true);
    expect(isCurrentSection("/blog/an-article", "/blog")).toBe(true);
    expect(isCurrentSection("/blogroll", "/blog")).toBe(false);
    expect(isCurrentSection("/blog", "/")).toBe(false);
    expect(isCurrentSection("/", "/")).toBe(true);
  });
});
