import ReactMarkdown, { type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Prose, proseComponents, resolveProseLink } from "@/components/public/prose";

type SafeMarkdownProps = {
  markdown: string;
};

/**
 * Provider-authored Markdown is content, never code. Raw HTML and embedded Markdown images are
 * discarded; links pass through the same explicit allowlist as the visual component map.
 */
const safeUrlTransform: UrlTransform = (url, key) => {
  if (key === "src") return "";
  return resolveProseLink(url)?.href ?? "";
};

const markdownComponents = {
  ...proseComponents,
  img: () => null,
} satisfies React.ComponentProps<typeof ReactMarkdown>["components"];

export function SafeMarkdown({ markdown }: SafeMarkdownProps) {
  return (
    <Prose>
      <ReactMarkdown
        components={markdownComponents}
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeUrlTransform}
      >
        {markdown}
      </ReactMarkdown>
    </Prose>
  );
}
