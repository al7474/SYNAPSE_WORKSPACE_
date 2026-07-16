type EmbeddingsApiResponse = {
  data?: Array<{ embedding?: number[] }>;
};

export class OpenRouterEmbeddingsService {
  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  isConfigured(): boolean {
    return this.apiKey.trim().length > 0;
  }

  async generateEmbedding(input: string): Promise<number[]> {
    if (!this.isConfigured()) {
      throw new Error("OPENROUTER_API_KEY is not configured");
    }

    const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as EmbeddingsApiResponse;

    if (!response.ok) {
      throw new Error(`OpenRouter embeddings request failed with status ${response.status}`);
    }

    const embedding = payload.data?.[0]?.embedding;

    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("Invalid embeddings payload from OpenRouter");
    }

    return embedding;
  }
}
