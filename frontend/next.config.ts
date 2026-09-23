import type { NextConfig } from "next";

const BACKEND = process.env.SECP_API_PROXY ?? "http://127.0.0.1:8085";

const nextConfig: NextConfig = {
  // Next dev отказва ресурси, ако Origin не е localhost (например 127.0.0.1).
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.145"],
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: `${BACKEND}/v1/:path*` },
      { source: "/health", destination: `${BACKEND}/health` },
      { source: "/ready", destination: `${BACKEND}/ready` },
    ];
  },
};

export default nextConfig;
