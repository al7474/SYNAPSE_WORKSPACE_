import { GRAPHQL_ENDPOINT } from "./graphql-endpoint";

let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;

type GraphQLErrorPayload = {
  message: string;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLErrorPayload[];
};

async function getCsrfToken(): Promise<string> {
  if (csrfToken) {
    return csrfToken;
  }

  if (!csrfRequest) {
    const csrfEndpoint = new URL("/auth/csrf", GRAPHQL_ENDPOINT).toString();

    csrfRequest = fetch(csrfEndpoint, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to initialize secure session");
        }

        const payload = (await response.json()) as { csrfToken?: string };

        if (!payload.csrfToken) {
          throw new Error("Unable to initialize secure session");
        }

        csrfToken = payload.csrfToken;
        return payload.csrfToken;
      })
      .finally(() => {
        csrfRequest = null;
      });
  }

  return csrfRequest;
}

export async function graphQLRequest<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-CSRF-Token": await getCsrfToken(),
  };

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify({ query, variables }),
  });

  const payload = (await response.json()) as GraphQLResponse<T>;

  if (!response.ok || payload.errors?.length) {
    const message = payload.errors?.map((error) => error.message).join(" | ") || "GraphQL request failed";
    throw new Error(message);
  }

  if (!payload.data) {
    throw new Error("GraphQL request returned no data");
  }

  return payload.data;
}

export function buildNoteSubscriptionUrl(
  boardId: string,
  shareToken: string | null
): string {
  const subscriptionQuery = `
    subscription NoteUpdated($boardId: ID!, $shareToken: String) {
      noteUpdated(boardId: $boardId, shareToken: $shareToken) {
        id
        boardId
        title
        content
        embeddingPending
      }
    }
  `;

  const queryParam = encodeURIComponent(subscriptionQuery);
  const variablesParam = encodeURIComponent(JSON.stringify({ boardId, shareToken }));

  return `${GRAPHQL_ENDPOINT}?query=${queryParam}&variables=${variablesParam}`;
}

export { GRAPHQL_ENDPOINT };
