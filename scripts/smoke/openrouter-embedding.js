const OPENROUTER_URL = "https://openrouter.ai/api/v1/embeddings";
const MODEL = process.env.OPENROUTER_EMBEDDING_MODEL || "nvidia/llama-nemotron-embed-vl-1b-v2:free";
const EMBEDDING_DIMENSION = Number(process.env.OPENROUTER_EMBEDDING_DIMENSION || 1024);
const INPUT_TEXT = process.env.OPENROUTER_TEST_INPUT || "Hello Synapse Workspace";

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    console.error("Missing OPENROUTER_API_KEY environment variable.");
    process.exit(1);
  }

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        input: INPUT_TEXT,
        dimensions: EMBEDDING_DIMENSION,
      }),
    });

    const responseBody = await response.json().catch(() => ({}));

    console.log(`HTTP status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      console.error("OpenRouter request failed:");
      console.error(JSON.stringify(responseBody, null, 2));
      process.exit(1);
    }

    const embedding = responseBody?.data?.[0]?.embedding;

    if (!Array.isArray(embedding) || embedding.length === 0) {
      console.error("Unexpected response shape: embedding vector not found.");
      console.error(JSON.stringify(responseBody, null, 2));
      process.exit(1);
    }

    if (embedding.length !== EMBEDDING_DIMENSION) {
      console.error(`Unexpected vector length: expected ${EMBEDDING_DIMENSION}, received ${embedding.length}.`);
      process.exit(1);
    }

    const firstFive = embedding.slice(0, 5);
    const firstFiveAreNumbers = firstFive.every(
      (value) => typeof value === "number" && Number.isFinite(value)
    );

    console.log("Model:", MODEL);
    console.log("Requested dimension:", EMBEDDING_DIMENSION);
    console.log("Input:", INPUT_TEXT);
    console.log("First 5 values:", firstFive);
    console.log("Vector length:", embedding.length);
    console.log("First 5 are finite numbers:", firstFiveAreNumbers);
  } catch (error) {
    console.error("Network/runtime error while calling OpenRouter:");
    console.error(error);
    process.exit(1);
  }
}

main();
