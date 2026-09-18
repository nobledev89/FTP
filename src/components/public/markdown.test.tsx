import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SafeMarkdown } from "./markdown";

describe("SafeMarkdown", () => {
  it("renders GFM through the editorial component allowlist", () => {
    const html = renderToStaticMarkup(
      <SafeMarkdown
        markdown={"## Rates\n\n| Product | Rate |\n| --- | ---: |\n| Saver | **5%** |"}
      />,
    );

    expect(html).toContain("<h2");
    expect(html).toContain("<table");
    expect(html).toContain("<strong");
  });

  it("drops raw HTML and embedded images and neutralises unsafe links", () => {
    const markdown = [
      "<script>globalThis.pwned = true</script>",
      '<img src="https://attacker.example/tracker.png" onerror="alert(1)">',
      "![tracking pixel](https://attacker.example/pixel.png)",
      "[unsafe](javascript:alert(1))",
      "[safe](https://example.com/report)",
    ].join("\n\n");
    const html = renderToStaticMarkup(<SafeMarkdown markdown={markdown} />);

    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("onerror");
    expect(html).toContain('href="https://example.com/report"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });
});
