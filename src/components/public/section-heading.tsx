// Adapted from Paperframe `SectionHeading` (MIT), see THIRD_PARTY_NOTICES.md.
import { Eyebrow } from "@/components/public/meta";
import { TextLink } from "@/components/public/text-link";
import { cn } from "@/lib/utils/cn";

type SectionHeadingProps = {
  id: string;
  eyebrow: string;
  title: string;
  cta?: { href: string; label: string };
  tone?: "paper" | "dark";
};

export function SectionHeading({ id, eyebrow, title, cta, tone = "paper" }: SectionHeadingProps) {
  const dark = tone === "dark";
  return (
    <div className="mb-10 sm:mb-12">
      <Eyebrow className="mb-4" tone={tone}>
        {eyebrow}
      </Eyebrow>
      <div
        className={cn(
          "flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b pb-6",
          dark ? "border-dark-line" : "border-line",
        )}
      >
        <h2
          className={cn(
            "font-serif text-4xl font-semibold leading-none tracking-tight sm:text-5xl",
            dark ? "text-white" : "text-ink",
          )}
          id={id}
        >
          {title}
        </h2>
        {cta ? (
          <TextLink href={cta.href} tone={tone}>
            {cta.label}
          </TextLink>
        ) : null}
      </div>
    </div>
  );
}
