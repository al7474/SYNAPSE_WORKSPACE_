#!/usr/bin/env node

const BASE_URL = readOrigin("SMOKE_BASE_URL");
const FRONTEND_ORIGIN = readOrigin("SMOKE_FRONTEND_ORIGIN");
const REQUEST_TIMEOUT_MS = 15_000;

function readOrigin(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${name} must be an HTTP(S) origin without credentials or a path`);
  }

  return parsed.origin;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function endpoint(path) {
  return `${BASE_URL}${path}`;
}

async function request(path, options = {}) {
  return fetch(endpoint(path), {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function readJson(response, label) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON content`);
  }
}

function assertCors(response, label) {
  assert(
    response.headers.get("access-control-allow-origin") === FRONTEND_ORIGIN,
    `${label} did not return the configured CORS origin`
  );
  assert(
    response.headers.get("access-control-allow-credentials") === "true",
    `${label} did not allow credentials`
  );
}

async function main() {
  const healthResponse = await request("/healthz");
  const healthPayload = await readJson(healthResponse, "/healthz");
  assert(healthResponse.status === 200, `/healthz returned ${healthResponse.status}`);
  assert(healthPayload?.status === "ok", "/healthz returned an unexpected payload");

  const readinessResponse = await request("/readyz");
  const readinessPayload = await readJson(readinessResponse, "/readyz");
  assert(readinessResponse.status === 200, `/readyz returned ${readinessResponse.status}`);
  assert(readinessPayload?.status === "ready", "/readyz returned an unexpected payload");

  const preflightResponse = await request("/graphql", {
    method: "OPTIONS",
    headers: {
      Origin: FRONTEND_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type, x-csrf-token",
    },
  });
  assert(preflightResponse.status === 204, `/graphql CORS preflight returned ${preflightResponse.status}`);
  assertCors(preflightResponse, "GraphQL CORS preflight");
  const allowedHeaders = (preflightResponse.headers.get("access-control-allow-headers") || "")
    .toLowerCase()
    .split(",")
    .map((header) => header.trim());
  assert(allowedHeaders.includes("content-type"), "CORS did not allow Content-Type");
  assert(allowedHeaders.includes("x-csrf-token"), "CORS did not allow X-CSRF-Token");

  const csrfResponse = await request("/auth/csrf", {
    headers: { Origin: FRONTEND_ORIGIN },
  });
  const csrfPayload = await readJson(csrfResponse, "/auth/csrf");
  const setCookie = csrfResponse.headers.get("set-cookie") || "";
  assert(csrfResponse.status === 200, `/auth/csrf returned ${csrfResponse.status}`);
  assertCors(csrfResponse, "CSRF bootstrap");
  assert(typeof csrfPayload?.csrfToken === "string" && csrfPayload.csrfToken.length > 0, "CSRF token was not returned");
  assert(setCookie.includes("synapse_csrf_token="), "CSRF cookie was not set");
  const csrfCookie = setCookie.split(";")[0];

  const rejectedMutationResponse = await request("/auth/guest-session", {
    method: "POST",
    headers: {
      Origin: FRONTEND_ORIGIN,
      Cookie: csrfCookie,
    },
  });
  const rejectedMutationPayload = await readJson(rejectedMutationResponse, "CSRF rejection");
  assert(
    rejectedMutationResponse.status === 403,
    `A mutation without a CSRF header returned ${rejectedMutationResponse.status}`
  );
  assert(
    rejectedMutationPayload?.error === "Invalid CSRF token",
    "CSRF rejection returned an unexpected payload"
  );

  const graphqlResponse = await request("/graphql", {
    method: "POST",
    headers: {
      Origin: FRONTEND_ORIGIN,
      "Content-Type": "application/json",
      Cookie: csrfCookie,
      "X-CSRF-Token": csrfPayload.csrfToken,
    },
    body: JSON.stringify({ query: "query DeploymentSmoke { __typename }" }),
  });
  const graphqlPayload = await readJson(graphqlResponse, "GraphQL read");
  assert(graphqlResponse.status === 200, `GraphQL read returned ${graphqlResponse.status}`);
  assertCors(graphqlResponse, "GraphQL read");
  assert(!graphqlPayload?.errors, `GraphQL read returned errors: ${JSON.stringify(graphqlPayload?.errors)}`);
  assert(graphqlPayload?.data?.__typename === "Query", "GraphQL read returned an unexpected payload");

  console.log(
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        frontendOrigin: FRONTEND_ORIGIN,
        health: "ok",
        readiness: "ready",
        cors: "ok",
        csrf: "ok",
        graphql: "ok",
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Deployment smoke test failed:");
  console.error(error);
  process.exit(1);
});