type EmbeddingsApiResponse = {
  data?: Array<{ embedding?: number[] }>;
};

export type OpenRouterEmbeddingsOptions = {
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

function readPositiveOption(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function readNonNegativeOption(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return value;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && error.name === "AbortError");
}

function waitForRetry(delayMs: number): Promise<void> {
  if (delayMs === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export class OpenRouterEmbeddingsService {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly expectedDimension: number,
    options: OpenRouterEmbeddingsOptions = {}
  ) {
    this.timeoutMs = readPositiveOption(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
    this.maxAttempts = readPositiveOption(
      options.maxAttempts,
      DEFAULT_MAX_ATTEMPTS,
      "maxAttempts"
    );
    this.retryDelayMs = readNonNegativeOption(
      options.retryDelayMs,
      DEFAULT_RETRY_DELAY_MS,
      "retryDelayMs"
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  isConfigured(): boolean {
    return this.apiKey.trim().length > 0;
  }

  async generateEmbedding(input: string): Promise<number[]> {
    if (!this.isConfigured()) {
      throw new Error("OPENROUTER_API_KEY is not configured");
    }

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl("https://openrouter.ai/api/v1/embeddings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            input,
            dimensions: this.expectedDimension,
          }),
          signal: controller.signal,
        });

        const payload = (await response.json().catch(() => ({}))) as EmbeddingsApiResponse;

        if (!response.ok) {
          const error = new Error(
            `OpenRouter embeddings request failed with status ${response.status}`
          );

          if (!isRetryableStatus(response.status) || attempt === this.maxAttempts) {
            throw error;
          }
        } else {
          const embedding = payload.data?.[0]?.embedding;

          if (!Array.isArray(embedding) || embedding.length === 0) {
            throw new Error("Invalid embeddings payload from OpenRouter");
          }

          if (embedding.length !== this.expectedDimension) {
            throw new Error(
              `Embedding dimension mismatch: expected ${this.expectedDimension}, received ${embedding.length}`
            );
          }

          return embedding;
        }
      } catch (error) {
        if (!isRetryableError(error) || attempt === this.maxAttempts) {
          if (controller.signal.aborted) {
            throw new Error(`OpenRouter embeddings request timed out after ${this.timeoutMs}ms`);
          }

          throw error;
        }
      } finally {
        clearTimeout(timeoutId);
      }

      await waitForRetry(Math.min(this.retryDelayMs * 2 ** (attempt - 1), 5_000));
    }

    throw new Error("OpenRouter embeddings request exhausted its retry attempts");
  }
}
