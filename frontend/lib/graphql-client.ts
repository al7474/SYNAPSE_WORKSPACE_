const GRAPHQL_ENDPOINT =
  process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT || "http://localhost:4000/graphql";

type GraphQLErrorPayload = {
  message: string;
};

type GraphQLResponse<T> = {
  data?: T;
  errors?: GraphQLErrorPayload[];
};

export async function graphQLRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
  sessionId?: string,
  _userEmail?: string | null
): Promise<T> {
  if (!sessionId) {
    throw new Error("Session not initialized");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
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
  shareToken: string | null,
  _sessionId?: string,
  _userEmail?: string | null
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
