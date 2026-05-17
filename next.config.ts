import type { NextConfig } from "next";

// basePath must be set at build time. Default to "" so `npm run dev` keeps
// serving at "/". Production builds run on the host with
// `NEXT_PUBLIC_BASE_PATH=/ileads-qms npm run build` so the prefix is baked
// into both server and client bundles. See docs/deployment-runbook.md.
const rawBasePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim();
const basePath = rawBasePath && rawBasePath !== "/" ? rawBasePath : "";

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  serverExternalPackages: ["@prisma/client", "prisma"],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  // Don't let Turbopack/Next walk into the Python venv or model weights.
  outputFileTracingExcludes: {
    "*": [
      "**/.venv-stt/**",
      "**/models/**",
      "**/runtime/stt/**",
      "**/storage/audio/**",
    ],
  },
};

export default nextConfig;
