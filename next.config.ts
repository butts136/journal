import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@napi-rs/canvas",
    "argon2",
    "better-sqlite3",
    "webtorrent",
  ],
};

export default nextConfig;
