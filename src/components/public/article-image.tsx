// Adapted from Paperframe `CardImage` (MIT), see THIRD_PARTY_NOTICES.md.
import Image from "next/image";

import type { ImageAsset, ImageRatio } from "@/components/public/types";
import { cn } from "@/lib/utils/cn";

const ratioClass: Record<ImageRatio, string> = {
  card: "aspect-video",
  feature: "aspect-[4/5]",
  hero: "aspect-video",
  "hero-3-2": "aspect-[3/2]",
};

type ArticleImageProps = {
  image?: ImageAsset | null;
  ratio?: ImageRatio;
  /** Responsive `sizes` hint; required so the optimizer never serves oversized images. */
  sizes: string;
  /** Scale gently when an ancestor `.group` link is hovered. */
  interactive?: boolean;
  /** Above-the-fold hero images load eagerly with high fetch priority. */
  eager?: boolean;
  className?: string;
};

export function ArticleImage({
  image,
  ratio = "card",
  sizes,
  interactive = false,
  eager = false,
  className,
}: ArticleImageProps) {
  const frame = cn(
    "relative w-full overflow-hidden bg-wash ring-1 ring-line",
    ratioClass[ratio],
    className,
  );

  if (!image) {
    return <div aria-hidden="true" className={frame} data-image-placeholder="" />;
  }

  return (
    <div className={frame}>
      <Image
        alt={image.alt}
        className={cn(
          "object-cover",
          interactive &&
            "transition-transform duration-700 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100",
        )}
        fetchPriority={eager ? "high" : undefined}
        fill
        loading={eager ? "eager" : "lazy"}
        sizes={sizes}
        src={image.src}
        style={
          image.focalPoint
            ? { objectPosition: `${image.focalPoint.x}% ${image.focalPoint.y}%` }
            : undefined
        }
      />
    </div>
  );
}

type ArticleFigureProps = ArticleImageProps & {
  image: ImageAsset;
};

/** Image with an optional, visually subordinate caption. */
export function ArticleFigure({ image, ...props }: ArticleFigureProps) {
  return (
    <figure>
      <ArticleImage image={image} {...props} />
      {image.caption ? (
        <figcaption className="mt-3 max-w-prose-measure text-sm leading-6 text-muted">
          {image.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
