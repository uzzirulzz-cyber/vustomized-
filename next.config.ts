import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output is for the sandbox runtime (bun serving .next/standalone).
  // Vercel builds with its own runtime packaging — leave default there.
  output: process.env.VERCEL ? undefined : "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Meta CRM (Lead Pulse) lives at the /metacrm URL index.
  // The app is a single-page CRM at "/" with APIs under /api/lp/*,
  // so a beforeFiles alias keeps the browser URL pinned to /metacrm/*
  // while serving the exact same app — zero client code changes.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/metacrm", destination: "/" },
        { source: "/metacrm/:path*", destination: "/:path*" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async redirects() {
    return [{ source: "/", destination: "/metacrm", permanent: false }];
  },
};

export default nextConfig;

