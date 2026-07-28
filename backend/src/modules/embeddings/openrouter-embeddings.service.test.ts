import assert from "node:assert/strict";
import test from "node:test";
import { OpenRouterEmbeddingsService } from "./openrouter-embeddings.service.js";

test("retries transient OpenRouter responses with bounded backoff", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;

    if (calls < 3) {
      return new Response(JSON.stringify({ error: "temporary failure" }), { status: 503 });
    }

    return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), {
      status: 200,
    });
  };
  const service = new OpenRouterEmbeddingsService("test-key", "test-model", 3, {
    maxAttempts: 3,
    retryDelayMs: 0,
    fetchImpl,
  });

  const embedding = await service.generateEmbedding("test input");

  assert.deepEqual(embedding, [0.1, 0.2, 0.3]);
  assert.equal(calls, 3);
});

test("aborts timed out requests and stops after the configured attempts", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    calls += 1;

    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("The operation was aborted", "AbortError")),
        { once: true }
      );
    });
  };
  const service = new OpenRouterEmbeddingsService("test-key", "test-model", 3, {
    timeoutMs: 5,
    maxAttempts: 2,
    retryDelayMs: 0,
    fetchImpl,
  });

  await assert.rejects(
    service.generateEmbedding("test input"),
    /OpenRouter embeddings request timed out after 5ms/
  );
  assert.equal(calls, 2);
});