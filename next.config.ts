import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native or worker-based packages that must load from node_modules at runtime.
  serverExternalPackages: ["pdf-parse", "chromadb"],
  experimental: {
    serverActions: {
      // Several resume/JD files per upload (10 MB each max), plus multipart overhead.
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
