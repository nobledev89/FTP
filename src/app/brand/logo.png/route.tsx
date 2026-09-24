import { ImageResponse } from "next/og";

// Publisher logo for Organization and Article structured data: a crawlable 512×512 raster, since
// the SVG favicon is not accepted everywhere a logo is read.
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#1c1917",
        color: "#ffffff",
        display: "flex",
        fontFamily: "Georgia, serif",
        fontSize: 320,
        fontWeight: 600,
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      F
    </div>,
    { width: 512, height: 512 },
  );
}
