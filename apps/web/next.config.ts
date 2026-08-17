import type { NextConfig } from "next";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  // Workspace packages ship raw TS (main: src/index.ts) rather than built JS, so Next has to
  // run them through its own compiler. Without this, `next build` fails to parse their types.
  transpilePackages: ["@onelife/api-client", "@onelife/client-logic"],
  async rewrites() {
    // Backend mounts auth under /api/auth but read/me/gamertag routes at root.
    return [
      { source: "/api/auth/:path*", destination: `${API_ORIGIN}/api/auth/:path*` },
      { source: "/api/:path*", destination: `${API_ORIGIN}/:path*` },
      // Hero/inline images are served by apps/api at /media/*; proxy them so same-origin <img> URLs resolve.
      { source: "/media/:path*", destination: `${API_ORIGIN}/media/:path*` },
    ];
  },
};

export default nextConfig;
