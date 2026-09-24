import type { NextConfig } from "next";

const BACKEND = process.env.SECP_API_PROXY ?? "http://127.0.0.1:8085";

// Dev: каналът е на HTTP+1 (8086), защото Next не проксира WebSocket upgrade.
// Production оставя празно — same-origin /ws минава през проксито отпред.
// Изричен NEXT_PUBLIC_WS_PORT печели и в двата случая.
const wsPort =
  process.env.NEXT_PUBLIC_WS_PORT ??
  (process.env.NODE_ENV === "production" ? "" : "8086");

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_WS_PORT: wsPort,
  },
  // Next dev отказва ресурси, ако Origin не е localhost (например 127.0.0.1).
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.145"],
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: `${BACKEND}/v1/:path*` },
      // Публичните линкове (Фаза 3) живеят под /s/ на API-то; страницата им е
      // /share/<token> (различна пътека, за да не се бият).
      { source: "/s/:path*", destination: `${BACKEND}/s/:path*` },
      // ЗАБЕЛЕЖКА: НЕ слагаме `/ws` тук. `rewrites()` в Next проксира само
      // HTTP заявки — WS upgrade-ът минава през него като обикновена заявка и
      // връща 404. Каналът се стига или директно на `SECP_WS_PORT` (dev, през
      // `NEXT_PUBLIC_WS_PORT`), или през прокси пред приложението (production).
      // Виж „Realtime каналът (WS)" в README.
      { source: "/health", destination: `${BACKEND}/health` },
      { source: "/ready", destination: `${BACKEND}/ready` },
    ];
  },
};

export default nextConfig;
