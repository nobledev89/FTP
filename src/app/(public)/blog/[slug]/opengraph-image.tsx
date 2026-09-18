import { notFound } from "next/navigation";
import { ImageResponse } from "next/og";

import { resolvePublicArticle } from "@/lib/publication/repository";
import { siteConfig } from "@/lib/site/config";

export const alt = "FinTechPulse article share image";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function ArticleOpenGraphImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const resolution = await resolvePublicArticle((await params).slug);
  if (!resolution) notFound();
  const { article } = resolution;

  return new ImageResponse(
    <div
      style={{
        background: "#f8f7f3",
        color: "#151515",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "space-between",
        padding: "68px 80px",
        width: "100%",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          fontSize: 25,
          justifyContent: "space-between",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        <span>{siteConfig.name}</span>
        <span style={{ color: "#686862" }}>{article.category}</span>
      </div>
      <div
        style={{
          display: "flex",
          fontSize: article.title.length > 95 ? 54 : 66,
          fontWeight: 700,
          letterSpacing: "-0.03em",
          lineHeight: 1.08,
          maxWidth: 1040,
        }}
      >
        {article.title}
      </div>
      <div style={{ background: "#151515", display: "flex", height: 4, width: "100%" }} />
    </div>,
    size,
  );
}
