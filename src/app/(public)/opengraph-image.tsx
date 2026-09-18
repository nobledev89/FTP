import { ImageResponse } from "next/og";

import { siteConfig } from "@/lib/site/config";

export const alt = `${siteConfig.name}: ${siteConfig.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "stretch",
        background: "#f8f7f3",
        color: "#151515",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "space-between",
        padding: "72px 84px",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", fontSize: 28, letterSpacing: "0.16em" }}>
        UK FINANCE &amp; FINTECH
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 112, fontWeight: 700, letterSpacing: "-0.04em" }}>
          {siteConfig.name}
        </div>
        <div style={{ color: "#5b5b57", display: "flex", fontSize: 38, marginTop: 24 }}>
          {siteConfig.positioning}
        </div>
      </div>
      <div style={{ background: "#151515", display: "flex", height: 4, width: "100%" }} />
    </div>,
    size,
  );
}
