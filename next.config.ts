import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const localSupabase = /^http:\/\/(?:127\.0\.0\.1|localhost):54321(?:\/|$)/.test(supabaseUrl);

const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  images: {
    // Published snapshots can reference only article-public paths. The DTO layer additionally
    // requires the exact configured Supabase origin before a URL reaches next/image.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/article-public/**",
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "54321",
        pathname: "/storage/v1/object/public/article-public/**",
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "54321",
        pathname: "/storage/v1/object/public/article-public/**",
      },
    ],
    // Next 16 blocks private-network image fetches by default. Opt in only when this build points
    // at the fixed local Supabase development port; hosted builds keep the SSRF guard enabled.
    dangerouslyAllowLocalIP: localSupabase,
  },
  experimental: {
    // Public and admin have separate root layouts (ADR 0004), so unmatched URLs need a global 404.
    globalNotFound: true,
    // Manual Gemini uploads accept one image per action. Supabase and the application both enforce
    // a 10 MB file limit; the extra room covers multipart boundaries and the small metadata fields.
    serverActions: { bodySizeLimit: "11mb" },
    // src/proxy.ts runs on /admin, and a proxied request body is buffered only up to this size (10 MB
    // by default). Anything beyond it is silently dropped, which would corrupt the largest uploads
    // the action above accepts, so the two limits must match.
    proxyClientMaxBodySize: "11mb",
  },
  redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.fintechpulse.co.uk" }],
        destination: "https://fintechpulse.co.uk/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
