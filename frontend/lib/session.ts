import type { SessionMode, StoredSession } from "@/types/workspace";

const SESSION_ID_KEY = "synapse_session_id";
const SESSION_MODE_KEY = "synapse_session_mode";
const USER_EMAIL_KEY = "synapse_user_email";
const LEGACY_GUEST_SESSION_KEY = "synapse_guest_session_id";

function isSessionMode(value: string | null): value is SessionMode {
  return value === "guest" || value === "user";
}

export function createGuestSessionId(): string {
  return typeof crypto.randomUUID === "function"
    ? `guest_${crypto.randomUUID()}`
    : `guest_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function createUserSessionId(email: string): string {
  const normalizedEmail = email.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return `user_${normalizedEmail}`;
}

export function readStoredSession(): StoredSession | null {
  const storedSessionId = window.localStorage.getItem(SESSION_ID_KEY)?.trim() || "";
  const storedSessionMode = window.localStorage.getItem(SESSION_MODE_KEY);
  const storedUserEmail = window.localStorage.getItem(USER_EMAIL_KEY)?.trim().toLowerCase() || "";
  const legacyGuestId = window.localStorage.getItem(LEGACY_GUEST_SESSION_KEY)?.trim() || "";

  if (storedSessionId && isSessionMode(storedSessionMode)) {
    return {
      sessionId: storedSessionId,
      sessionMode: storedSessionMode,
      userEmail: storedSessionMode === "user" && storedUserEmail ? storedUserEmail : null,
    };
  }

  if (legacyGuestId) {
    persistSession(legacyGuestId, "guest");
    window.localStorage.removeItem(LEGACY_GUEST_SESSION_KEY);
    return {
      sessionId: legacyGuestId,
      sessionMode: "guest",
      userEmail: null,
    };
  }

  return null;
}

export function persistSession(sessionId: string, sessionMode: SessionMode, userEmail?: string | null): void {
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
