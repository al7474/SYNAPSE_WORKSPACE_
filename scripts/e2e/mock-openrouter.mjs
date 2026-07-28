import { createServer } from "node:http";

const port = Number(process.env.OPENROUTER_MOCK_PORT || 4010);
const dimension = 1024;

function hashToken(token) {
  let hash = 2166136261;

  for (const character of token) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createEmbedding(input) {
  const vector = Array.from({ length: dimension }, () => 0);
  const tokens = input.toLowerCase().match(/[a-z0-9]+/g) || [];

  for (const token of tokens) {
    vector[hashToken(token) % dimension] += 1;
  }

  if (tokens.length === 0) {
    vector[0] = 1;
  }

  return vector;
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/embeddings") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const chunks = [];

  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const input = typeof payload.input === "string" ? payload.input : "";
      sendJson(response, 200, { data: [{ embedding: createEmbedding(input) }] });
    } catch {
      sendJson(response, 400, { error: "Invalid JSON payload" });
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`OpenRouter mock running on http://127.0.0.1:${port}`);
});

function closeServer() {
  server.close(() => process.exit(0));
}

process.once("SIGTERM", closeServer);
process.once("SIGINT", closeServer);