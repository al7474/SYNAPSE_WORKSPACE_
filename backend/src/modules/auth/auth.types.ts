export type OwnerKind = "user" | "guest" | "legacy";

export type AuthActionTokenPurpose = "email_verification" | "password_reset";

export interface OwnerMetadata {
  ownerKind: OwnerKind;
  ownerUserId?: string | null;
  ownerGuestSessionId?: string | null;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastActivityAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: string | null;
}

export interface AuthSessionContext {
  sessionId: string;
  user: AuthUser;
  expiresAt: Date;
}