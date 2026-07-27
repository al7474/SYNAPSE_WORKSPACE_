import crypto from "node:crypto";
import type { ServerResponse } from "node:http";

export const CSRF_COOKIE_NAME = "synapse_csrf_token";
export const CSRF_HEADER_NAME = "x-csrf-token";

export function createCsrfToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function readCookieValue(
  cookieHeader: string | null | undefined,
  name: string
): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const separatorIndex = cookie.indexOf("=");

    if (separatorIndex === -1 || cookie.slice(0, separatorIndex).trim() !== name) {
      continue;
    }

    const value = cookie.slice(separatorIndex + 1).trim();

    try {
      return value ? decodeURIComponent(value) : null;
    } catch {
      return null;
    }
  }

  return null;
}

export function readCsrfCookie(request: Request): string | null {
  return readCookieValue(request.headers.get("cookie"), CSRF_COOKIE_NAME);
}

export function isCsrfTokenValid(
  cookieHeader: string | null | undefined,
  headerToken: string | null | undefined
): boolean {
  const cookieToken = readCookieValue(cookieHeader, CSRF_COOKIE_NAME);

  if (!cookieToken || !headerToken) {
    return false;
  }

  const cookieBytes = Buffer.from(cookieToken);
  const headerBytes = Buffer.from(headerToken);

  return (
    cookieBytes.length === headerBytes.length &&
    crypto.timingSafeEqual(cookieBytes, headerBytes)
  );
}

export function serializeCsrfCookie(token: string, secure: boolean): string {
  return `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=3600; Path=/; SameSite=${secure ? "None" : "Lax"}${secure ? "; Secure" : ""}`;
}

export function setCsrfCookie(response: ServerResponse, token: string, secure: boolean): void {
  response.setHeader("Set-Cookie", serializeCsrfCookie(token, secure));
}