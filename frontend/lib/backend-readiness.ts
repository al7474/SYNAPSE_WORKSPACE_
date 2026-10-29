import { GRAPHQL_ENDPOINT } from "./graphql-endpoint";

export const READINESS_POLL_MESSAGE =
  "The demo server is waking up. This usually takes up to 30 seconds on the free hosting tier.";

export type ReadinessPollOptions = {
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
  requestTimeoutMs?: number;
  totalBudgetMs?: number;
  backoffMs?: number[];
};

function getBackendOrigin(): string {
  return new URL(GRAPHQL_ENDPOINT).origin;
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The readiness check was aborted", "AbortError"));
      return;
    }

    const timeoutId = globalThis.setTimeout(resolve, delayMs);
    const abort = () => {
      globalThis.clearTimeout(timeoutId);
      reject(new DOMException("The readiness check was aborted", "AbortError"));
    };

    signal.addEventListener("abort", abort, { once: true });
  });
}

async function checkReadiness(
  readinessUrl: string,
  signal: AbortSignal,
  fetchFn: typeof fetch,
  requestTimeoutMs: number
): Promise<boolean> {
  const requestController = new AbortController();
  const timeoutId = globalThis.setTimeout(() => requestController.abort(), requestTimeoutMs);
  const abortRequest = () => requestController.abort();
  signal.addEventListener("abort", abortRequest, { once: true });

  try {
    const response = await fetchFn(readinessUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: requestController.signal,
    });
    return response.status === 200;
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal.removeEventListener("abort", abortRequest);
  }
}

export async function waitForBackendReadiness(options: ReadinessPollOptions = {}): Promise<void> {
  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  const fetchFn = options.fetchFn ?? fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
  const totalBudgetMs = options.totalBudgetMs ?? 75_000;
  const backoffMs = options.backoffMs ?? [2_000, 3_000, 5_000];
  const deadline = Date.now() + totalBudgetMs;
  const readinessUrl = `${getBackendOrigin()}/readyz`;
  let attempt = 0;

  while (Date.now() < deadline) {
    try {
      if (await checkReadiness(readinessUrl, signal, fetchFn, requestTimeoutMs)) {
        return;
      }
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
    }

    const remainingMs = deadline - Date.now();

    if (remainingMs <= 0) {
      break;
    }

    await wait(Math.min(backoffMs[Math.min(attempt, backoffMs.length - 1)], remainingMs), signal);
    attempt += 1;
  }

  throw new Error("The demo server did not become ready in time. Please retry the connection.");
}

export function isTransientNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError");
}
