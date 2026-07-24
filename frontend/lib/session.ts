import type { SessionMode, StoredSession } from "@/types/workspace";

const GRAPHQL_ENDPOINT =
  process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT || "http://localhost:4000/graphql";
const SESSION_ID_KEY = "synapse_session_id";
const SESSION_MODE_KEY = "synapse_session_mode";
const USER_EMAIL_KEY = "synapse_user_email";
const LEGACY_GUEST_SESSION_KEY = "synapse_guest_session_id";

type GuestSessionResponse = {
  sessionId: string;
  sessionMode: "guest";
  userEmail: null;
  expiresAt: string;
};

function getGuestSessionEndpoint(): string {
  const baseUrl = typeof window === "undefined" ? "http://localhost:3000" : window.location.origin;
  return `${new URL(GRAPHQL_ENDPOINT, baseUrl).origin}/auth/guest-session`;
}

export function createUserSessionId(email: string): string {
  const normalizedEmail = email.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `user_${normalizedEmail}`;
}

function readLegacyUserSession(): StoredSession | null {
  const storedSessionId = window.localStorage.getItem(SESSION_ID_KEY)?.trim() || "";
  const storedSessionMode = window.localStorage.getItem(SESSION_MODE_KEY);
  const storedUserEmail = window.localStorage.getItem(USER_EMAIL_KEY)?.trim().toLowerCase() || "";

  if (storedSessionId && storedSessionMode === "user" && storedUserEmail) {
    return {
      sessionId: storedSessionId,
      sessionMode: "user",
      userEmail: storedUserEmail,
    };
  }

  return null;
}

export async function readStoredSession(): Promise<StoredSession | null> {
  try {
    const response = await fetch(getGuestSessionEndpoint(), {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (response.ok) {
      const payload = (await response.json()) as GuestSessionResponse;

      return {
        sessionId: payload.sessionId,
        sessionMode: payload.sessionMode,
        userEmail: payload.userEmail,
      };
    }

    if (response.status !== 401) {
      throw new Error("Unable to restore demo session");
    }
  } catch {
    const legacySession = readLegacyUserSession();

    if (legacySession) {
      return legacySession;
    }
  }

  clearStoredSession();
  return null;
}

export async function createGuestSession(): Promise<StoredSession> {
  const response = await fetch(getGuestSessionEndpoint(), {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("Unable to start demo mode");
  }

  const payload = (await response.json()) as GuestSessionResponse;

  clearStoredSession();

  return {
    sessionId: payload.sessionId,
    sessionMode: payload.sessionMode,
    userEmail: payload.userEmail,
  };
}

export async function deleteGuestSession(): Promise<void> {
  const response = await fetch(getGuestSessionEndpoint(), {
    method: "DELETE",
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("Unable to delete demo workspace");
  }

  clearStoredSession();
}

export function persistSession(sessionId: string, sessionMode: SessionMode, userEmail?: string | null): void {
  if (sessionMode === "guest") {
    clearStoredSession();
    return;
  }

  window.localStorage.setItem(SESSION_ID_KEY, sessionId);
  window.localStorage.setItem(SESSION_MODE_KEY, sessionMode);

  if (userEmail) {
    window.localStorage.setItem(USER_EMAIL_KEY, userEmail);
  } else {
    window.localStorage.removeItem(USER_EMAIL_KEY);
  }
}

export function clearStoredSession(): void {
  window.localStorage.removeItem(SESSION_ID_KEY);
  window.localStorage.removeItem(SESSION_MODE_KEY);
  window.localStorage.removeItem(USER_EMAIL_KEY);
  window.localStorage.removeItem(LEGACY_GUEST_SESSION_KEY);
}
