import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@anthropic-ai/sdk", "@google/genai", "groq-sdk"],
  devIndicators: false,
};

export default nextConfig;
