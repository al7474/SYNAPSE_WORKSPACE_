import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT = "https://api.example.test/graphql";

async function getReadinessPoller(): Promise<
  typeof import("./backend-readiness")
> {
  return import("./backend-readiness");
}

function response(status: number): Response {
  return new Response(null, { status });
}

test("readiness succeeds immediately", async () => {
  const { waitForBackendReadiness } = await getReadinessPoller();
  let requests = 0;

  await waitForBackendReadiness({
    fetchFn: async () => {
      requests += 1;
      return response(200);
    },
    totalBudgetMs: 100,
  });

  assert.equal(requests, 1);
});

test("readiness succeeds after failures", async () => {
  const { waitForBackendReadiness } = await getReadinessPoller();
  let requests = 0;

  await waitForBackendReadiness({
    fetchFn: async () => {
      requests += 1;
      return response(requests === 3 ? 200 : 503);
    },
    backoffMs: [1],
    totalBudgetMs: 100,
  });

  assert.equal(requests, 3);
});

test("readiness rejects when its budget is exhausted", async () => {
  const { waitForBackendReadiness } = await getReadinessPoller();
  await assert.rejects(
    waitForBackendReadiness({
      fetchFn: async () => response(503),
      backoffMs: [1],
      totalBudgetMs: 5,
    }),
    /did not become ready/
  );
});

test("readiness stops when aborted", async () => {
  const { waitForBackendReadiness } = await getReadinessPoller();
  const controller = new AbortController();
  const promise = waitForBackendReadiness({
    signal: controller.signal,
    fetchFn: async () => response(503),
    backoffMs: [100],
    totalBudgetMs: 1_000,
  });

  controller.abort();

  await assert.rejects(promise, { name: "AbortError" });
});
