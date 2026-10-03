import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@anthropic-ai/sdk", "@google/genai", "groq-sdk"],
  devIndicators: false,
  // Plan uploads (.dwg / .dxf) can be large; the proxy buffers request bodies up to this size (default 10 MB).
  experimental: { proxyClientMaxBodySize: "32mb" },
};

export default nextConfig;
