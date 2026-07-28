import type { NextConfig } from "next";

const noCacheHeaders = [
  { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
  { key: "Pragma", value: "no-cache" },
  { key: "Expires", value: "0" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

function validateGraphqlEndpointForBuild(): void {
  const value = process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT?.trim();

  if (!value) {
    throw new Error(
      "NEXT_PUBLIC_GRAPHQL_ENDPOINT is required before building the frontend"
    );
  }

  let endpoint: URL;

  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("NEXT_PUBLIC_GRAPHQL_ENDPOINT must be an absolute URL");
  }

  const normalizedPath = endpoint.pathname.replace(/\/+$/, "") || "/";

  if (
    (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") ||
    normalizedPath !== "/graphql" ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error(
      "NEXT_PUBLIC_GRAPHQL_ENDPOINT must be an HTTP(S) URL ending in /graphql without query or hash"
    );
  }

  const deploymentEnvironment =
    process.env.SYNAPSE_DEPLOYMENT_ENV?.trim() || process.env.VERCEL_ENV?.trim();

  if (deploymentEnvironment === "production") {
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

    if (endpoint.protocol !== "https:" || localHosts.has(endpoint.hostname)) {
      throw new Error(
        "Production frontend builds require an HTTPS NEXT_PUBLIC_GRAPHQL_ENDPOINT that is not localhost"
      );
    }
  }
}

validateGraphqlEndpointForBuild();

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
