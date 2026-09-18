/**
 * View models consumed by public components. Phase 7 repositories map Zod-validated database DTOs
 * into these shapes; components never receive raw database rows.
 */

export type ImageRatio = "card" | "feature" | "hero" | "hero-3-2";

export type ImageAsset = {
  readonly src: string;
  readonly alt: string;
  readonly caption?: string;
  readonly aspectRatio?: "16:9" | "4:5" | "3:2" | "1:1";
  /** Focal point in percent, used for responsive `object-position`. */
  readonly focalPoint?: { readonly x: number; readonly y: number };
};

export type ArticleSummary = {
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string;
  readonly category: string;
  readonly publishedAt: string;
  readonly image?: ImageAsset | null;
};

export type Byline = {
  readonly name: string;
  readonly role?: string;
};

export type SourceReference = {
  readonly id: string;
  readonly title: string;
  readonly publisher: string;
  readonly url: string;
  readonly publishedAt?: string | null;
  readonly accessedAt: string;
};
