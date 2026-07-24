export type OwnerKind = "user" | "guest" | "legacy";

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