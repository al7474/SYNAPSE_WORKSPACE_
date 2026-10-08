import {
  buildNoteSubscriptionUrl,
  requestSubscriptionTicket,
  type NoteSubscriptionEventName,
} from "@/lib/graphql-client";

const MAX_TICKET_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

type NoteSubscriptionOptions = {
  boardId: string;
  shareToken: string | null;
  eventName: NoteSubscriptionEventName;
  onMessage: (event: Event) => void;
  onError: () => void;
};

/**
 * Account sessions reconnect through EventSource with the session cookie. Share-link subscriptions
 * request a fresh single-use ticket for every connection, so a dropped stream retries with a new ticket.
 */
export function openNoteSubscription(options: NoteSubscriptionOptions): () => void {
  const { boardId, shareToken, eventName, onMessage, onError } = options;
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let stopped = false;

  const closeSource = () => {
    source?.close();
    source = null;
  };

  const connectWithSession = () => {
    const next = new EventSource(buildNoteSubscriptionUrl(boardId, null, eventName), {
      withCredentials: true,
    });

    source = next;
    next.addEventListener("next", onMessage);
    next.onerror = onError;
  };

  const scheduleRetry = () => {
    failures += 1;

    if (failures > MAX_TICKET_RETRIES) {
      onError();
      return;
    }

    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connectWithTicket();
    }, RETRY_BASE_DELAY_MS * 2 ** (failures - 1));
  };

  const connectWithTicket = async () => {
    if (!shareToken) {
      return;
    }

    try {
      const { ticket } = await requestSubscriptionTicket(boardId, shareToken, eventName);

      if (stopped) {
        return;
      }

      const next = new EventSource(buildNoteSubscriptionUrl(boardId, ticket, eventName), {
        withCredentials: true,
      });

      source = next;
      next.addEventListener("open", () => {
        failures = 0;
      });
      next.addEventListener("next", onMessage);
      next.onerror = () => {
        if (stopped || source !== next) {
          return;
        }

        closeSource();
        scheduleRetry();
      };
    } catch {
      if (!stopped) {
        scheduleRetry();
      }
    }
  };

  if (shareToken) {
    void connectWithTicket();
  } else {
    connectWithSession();
  }

  return () => {
    stopped = true;

    if (retryTimer !== null) {
      clearTimeout(retryTimer);
    }

    closeSource();
  };
}
