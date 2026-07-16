import { DEFAULT_MODEL, OPENROUTER_URL } from "./constants.js";

export function toPgvectorLiteral(vector) {
  return `[${vector.join(",")}]`;
}

export async function fetchEmbedding({
  input,
  apiKey = process.env.OPENROUTER_API_KEY,
  model = DEFAULT_MODEL,
  timeoutMs = 15000,
}) {
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY in environment.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(`OpenRouter error ${response.status}: ${JSON.stringify(payload)}`);
    }

    const embedding = payload?.data?.[0]?.embedding;

    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error(`Invalid embedding payload: ${JSON.stringify(payload)}`);
    }

    return embedding;
  } finally {
    clearTimeout(timeout);
  }
}
