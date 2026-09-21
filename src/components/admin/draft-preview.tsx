import ReactMarkdown, { type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import type { HeroPreview } from "@/lib/admin/jobs";

/**
 * A draft rendered for reading, not for inspection: headline, standfirst, hero image, and the body
 * as formatted text. It follows the admin type system (docs/DESIGN-SYSTEM.md section 10, no serif
 * and no public components), so it shows what the article says rather than a pixel copy of the
 * public page.
 *
 * Provider-authored Markdown is content, never code: raw HTML is skipped, Markdown images are
 * dropped, and only http(s), root-relative, and fragment links survive, matching the public
 * renderer's rules.
 */

function safeHref(url: string): string {
  const value = url.trim();
  if (value.startsWith("#")) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  } catch {
    return "";
  }
}

const urlTransform: UrlTransform = (url, key) => (key === "src" ? "" : safeHref(url));

const components = {
  h2: ({ children }) => (
    <h2 className="mt-8 text-lg font-semibold tracking-tight text-text">{children}</h2>
  ),
  h3: ({ children }) => <h3 className="mt-6 text-base font-semibold text-text">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-5 text-sm font-semibold text-text">{children}</h4>,
  p: ({ children }) => <p className="mt-4 text-[15px] leading-7 text-text">{children}</p>,
  ul: ({ children }) => (
    <ul className="mt-4 list-disc space-y-2 pl-5 text-[15px] leading-7 text-text">{children}</ul>
  ),
  ol: ({ children, start }) => (
    <ol className="mt-4 list-decimal space-y-2 pl-5 text-[15px] leading-7 text-text" start={start}>
      {children}
    </ol>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-4 border-l-2 border-border-strong pl-4 text-text-muted">
      {children}
    </blockquote>
  ),
  a: ({ children, href }) =>
    href ? (
      <a
        className="text-accent underline underline-offset-2"
        href={href}
        rel="noreferrer nofollow"
        target="_blank"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  table: ({ children }) => (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border-strong px-2 py-1.5 font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-border px-2 py-1.5">{children}</td>,
  code: ({ children }) => (
    <code className="rounded-control bg-neutral-bg px-1 font-mono text-[13px]">{children}</code>
  ),
  hr: () => <hr className="my-6 border-border" />,
  img: () => null,
} satisfies React.ComponentProps<typeof ReactMarkdown>["components"];

type DraftPreviewProps = {
  title: string;
  excerpt: string;
  bodyMarkdown: string;
  category: string | null;
  hero: HeroPreview | null;
  /** Shown when the job asked for an image that is not ready yet. */
  heroPending: boolean;
};

export function DraftPreview({
  title,
  excerpt,
  bodyMarkdown,
  category,
  hero,
  heroPending,
}: DraftPreviewProps) {
  const words = bodyMarkdown.split(/\s+/).filter(Boolean).length;

  return (
    <article className="mx-auto w-full max-w-[42rem]" data-draft-preview>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
        {category ?? "Article"}
        <span className="ml-2 font-mono font-normal normal-case tracking-normal text-text-subtle">
          {words.toLocaleString("en-GB")} words · about {Math.max(1, Math.round(words / 230))} min
          read
        </span>
      </p>
      <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-text sm:text-[28px]">
        {title}
      </h2>
      <p className="mt-3 text-base leading-7 text-text-muted">{excerpt}</p>

      {hero ? (
        <figure className="mt-5">
          {/* A signed, short-lived Storage URL: next/image would cache it past its expiry. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={hero.alt}
            className="w-full rounded-panel border border-border object-cover"
            height={hero.height ?? undefined}
            src={hero.url}
            width={hero.width ?? undefined}
          />
          {hero.caption ? (
            <figcaption className="mt-1.5 text-xs text-text-muted">{hero.caption}</figcaption>
          ) : null}
        </figure>
      ) : heroPending ? (
        <p className="mt-5 flex aspect-[16/9] items-center justify-center rounded-panel border border-dashed border-border text-sm text-text-subtle">
          The image is not ready yet.
        </p>
      ) : null}

      <div className="mt-2">
        <ReactMarkdown
          components={components}
          remarkPlugins={[remarkGfm]}
          skipHtml
          urlTransform={urlTransform}
        >
          {bodyMarkdown}
        </ReactMarkdown>
      </div>
    </article>
  );
}
