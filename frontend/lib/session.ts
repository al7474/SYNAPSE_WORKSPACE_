import type { SessionMode, SessionState } from "@/types/workspace";

const GRAPHQL_ENDPOINT =
  process.env.NEXT_PUBLIC_GRAPHQL_ENDPOINT || "http://localhost:4000/graphql";
const LEGACY_SESSION_ID_KEY = "synapse_session_id";
const LEGACY_SESSION_MODE_KEY = "synapse_session_mode";
const LEGACY_USER_EMAIL_KEY = "synapse_user_email";
const LEGACY_GUEST_SESSION_KEY = "synapse_guest_session_id";

type GuestSessionResponse = {
  sessionId: string;
  sessionMode: "guest";
  userEmail: null;
  expiresAt: string;
};

type AccountSessionResponse = {
  sessionId: string;
  sessionMode: "user";
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    emailVerifiedAt: string | null;
  };
  expiresAt: string;
};

type RegisterResponse = AccountSessionResponse & {
  emailVerificationRequired: boolean;
  verificationEmailSent: boolean;
};

type VerifyEmailResponse = {
  verified: boolean;
  user: AccountSessionResponse["user"];
};

type PasswordResetResponse = {
  message: string;
};

function getBackendOrigin(): string {
  const baseUrl = typeof window === "undefined" ? "http://localhost:3000" : window.location.origin;
  return new URL(GRAPHQL_ENDPOINT, baseUrl).origin;
}

function getGuestSessionEndpoint(): string {
  return `${getBackendOrigin()}/auth/guest-session`;
}

function getAuthEndpoint(path: string): string {
  return `${getBackendOrigin()}${path}`;
}

async function parseResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  let payload: { error?: string } & Partial<T> = {};

  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(payload.error || fallbackMessage);
  }

  return payload as T;
}

function toAccountSessionState(payload: AccountSessionResponse): SessionState {
  return {
    sessionId: payload.sessionId,
    sessionMode: payload.sessionMode,
    userEmail: payload.user.email,
  };
}

export async function currentSession(mode?: SessionMode): Promise<SessionState | null> {
  if (mode !== "guest") {
    const accountResponse = await fetch(getAuthEndpoint("/auth/session"), {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    if (accountResponse.ok) {
      return toAccountSessionState(
        await parseResponse<AccountSessionResponse>(accountResponse, "Unable to restore account session")
      );
    }

    if (accountResponse.status !== 401) {
      throw new Error("Unable to restore account session");
    }

    if (mode === "user") {
      return null;
    }
  }

  const guestResponse = await fetch(getGuestSessionEndpoint(), {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (guestResponse.ok) {
    const payload = await parseResponse<GuestSessionResponse>(guestResponse, "Unable to restore demo session");

    return {
      sessionId: payload.sessionId,
      sessionMode: payload.sessionMode,
      userEmail: payload.userEmail,
    };
  }

  if (guestResponse.status === 401) {
    return null;
  }

  throw new Error("Unable to restore demo session");
}

export async function createGuestSession(): Promise<SessionState> {
  const response = await fetch(getGuestSessionEndpoint(), {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error("Unable to start demo mode");
  }

  const payload = (await response.json()) as GuestSessionResponse;

  return {
    sessionId: payload.sessionId,
    sessionMode: payload.sessionMode,
    userEmail: payload.userEmail,
  };
}

export async function registerAccount(
  name: string,
  email: string,
  password: string
): Promise<{ session: SessionState; verificationEmailSent: boolean }> {
  const response = await fetch(getAuthEndpoint("/auth/register"), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, email, password }),
  });
  const payload = await parseResponse<RegisterResponse>(response, "Unable to create account");

  return {
    session: toAccountSessionState(payload),
    verificationEmailSent: payload.verificationEmailSent,
  };
}

export async function loginAccount(email: string, password: string): Promise<SessionState> {
  const response = await fetch(getAuthEndpoint("/auth/login"), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const payload = await parseResponse<AccountSessionResponse>(response, "Unable to sign in");

  return toAccountSessionState(payload);
}

export async function logoutAccount(): Promise<void> {
  const response = await fetch(getAuthEndpoint("/auth/logout"), {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  await parseResponse<{ loggedOut: boolean }>(response, "Unable to sign out");
}

export async function requestPasswordReset(email: string): Promise<PasswordResetResponse> {
  const response = await fetch(getAuthEndpoint("/auth/password-reset/request"), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  return parseResponse<PasswordResetResponse>(response, "Unable to request password recovery");
}

export async function verifyEmail(token: string): Promise<VerifyEmailResponse> {
  const url = new URL(getAuthEndpoint("/auth/verify-email"));
  url.searchParams.set("token", token);

  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  return parseResponse<VerifyEmailResponse>(response, "Unable to verify email");
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const response = await fetch(getAuthEndpoint("/auth/password-reset/confirm"), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token, password }),
  });

  await parseResponse<{ passwordReset: boolean }>(response, "Unable to reset password");
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

  clearLegacySessionStorage();
}

export function clearLegacySessionStorage(): void {
  window.localStorage.removeItem(LEGACY_SESSION_ID_KEY);
  window.localStorage.removeItem(LEGACY_SESSION_MODE_KEY);
  window.localStorage.removeItem(LEGACY_USER_EMAIL_KEY);
  window.localStorage.removeItem(LEGACY_GUEST_SESSION_KEY);
}
