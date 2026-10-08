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

export type NoteSubscriptionEventName = "noteUpdated" | "noteDeleted";

export type SubscriptionTicket = {
  ticket: string;
  expiresAt: string;
};

export async function requestSubscriptionTicket(
  boardId: string,
  shareToken: string,
  eventName: NoteSubscriptionEventName
): Promise<SubscriptionTicket> {
  const data = await graphQLRequest<{ createSubscriptionTicket: SubscriptionTicket }>(
    `
      mutation CreateSubscriptionTicket($boardId: ID!, $shareToken: String!, $event: SubscriptionEvent!) {
        createSubscriptionTicket(boardId: $boardId, shareToken: $shareToken, event: $event) {
          ticket
          expiresAt
        }
      }
    `,
    { boardId, shareToken, event: eventName }
  );

  return data.createSubscriptionTicket;
}

/** Share tokens never appear in the URL. Share-link subscriptions carry only a single-use ticket. */
export function buildNoteSubscriptionUrl(
  boardId: string,
  ticket: string | null,
  eventName: NoteSubscriptionEventName = "noteUpdated"
): string {
  const subscriptionQuery =
    eventName === "noteUpdated"
      ? `
        subscription NoteUpdated($boardId: ID!, $ticket: String) {
          noteUpdated(boardId: $boardId, ticket: $ticket) {
            id
            boardId
            title
            content
            embeddingPending
          }
        }
      `
      : `
        subscription NoteDeleted($boardId: ID!, $ticket: String) {
          noteDeleted(boardId: $boardId, ticket: $ticket)
        }
      `;

  const queryParam = encodeURIComponent(subscriptionQuery);
  const variablesParam = encodeURIComponent(JSON.stringify(ticket ? { boardId, ticket } : { boardId }));

  return `${GRAPHQL_ENDPOINT}?query=${queryParam}&variables=${variablesParam}`;
}
export { GRAPHQL_ENDPOINT };
