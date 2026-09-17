import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  experimental: {
    // Public and admin have separate root layouts (ADR 0004), so unmatched URLs need a global 404.
    globalNotFound: true,
  },
};

export default nextConfig;
