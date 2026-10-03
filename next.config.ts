import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@anthropic-ai/sdk", "@google/genai"],
  devIndicators: false,
};

export default nextConfig;
