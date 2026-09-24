import type { NextConfig } from "next";

const BACKEND = process.env.SECP_API_PROXY ?? "http://127.0.0.1:8085";

const nextConfig: NextConfig = {
  // Next dev отказва ресурси, ако Origin не е localhost (например 127.0.0.1).
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.145"],
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: `${BACKEND}/v1/:path*` },
      // Публичните линкове (Фаза 3) живеят под /s/ на API-то; страницата им е
      // /share/<token> (различна пътека, за да не се бият).
      { source: "/s/:path*", destination: `${BACKEND}/s/:path*` },
      { source: "/health", destination: `${BACKEND}/health` },
      { source: "/ready", destination: `${BACKEND}/ready` },
    ];
  },
};

export default nextConfig;
