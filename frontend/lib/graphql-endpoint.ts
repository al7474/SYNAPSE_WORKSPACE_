const rawGraphqlEndpoint = process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT?.trim();

if (!rawGraphqlEndpoint) {
  throw new Error(
    "NEXT_PUBLIC_GRAPHQL_ENDPOINT is required. Configure the public backend GraphQL URL before building the frontend."
  );
}

let parsedGraphqlEndpoint: URL;

try {
  parsedGraphqlEndpoint = new URL(rawGraphqlEndpoint);
} catch {
  throw new Error("NEXT_PUBLIC_GRAPHQL_ENDPOINT must be an absolute URL");
}

if (parsedGraphqlEndpoint.protocol !== "http:" && parsedGraphqlEndpoint.protocol !== "https:") {
  throw new Error("NEXT_PUBLIC_GRAPHQL_ENDPOINT must use HTTP or HTTPS");
}

if (
  !["/graphql", "/graphql/"].includes(parsedGraphqlEndpoint.pathname) ||
  parsedGraphqlEndpoint.search ||
  parsedGraphqlEndpoint.hash
) {
  throw new Error("NEXT_PUBLIC_GRAPHQL_ENDPOINT must point to /graphql without query or hash");
}

export const GRAPHQL_ENDPOINT = parsedGraphqlEndpoint.toString().replace(/\/$/, "");