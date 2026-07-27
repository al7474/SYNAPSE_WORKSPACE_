import type { NextConfig } from "next";

const noCacheHeaders = [
  { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
  { key: "Pragma", value: "no-cache" },
  { key: "Expires", value: "0" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/",
        headers: noCacheHeaders,
      },
      {
        source: "/auth/:path*",
        headers: noCacheHeaders,
      },
    ];
  },
};

export default nextConfig;
