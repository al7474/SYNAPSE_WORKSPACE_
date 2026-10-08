import crypto from "node:crypto";

export type SubscriptionEventName = "noteUpdated" | "noteDeleted";

export interface SubscriptionTicketGrant {
  boardId: string;
  event: SubscriptionEventName;
  shareTokenHash: string;
  revalidateSession: () => Promise<boolean>;
}

export interface IssuedSubscriptionTicket {
  ticket: string;
  expiresAt: string;
}

export interface SubscriptionTicketServiceOptions {
  ttlMs: number;
  maxPendingTickets: number;
  now?: () => number;
}

const MIN_TTL_MS = 30_000;
const MAX_TTL_MS = 60_000;
const INVALID_TICKET_MESSAGE = "Invalid or expired subscription ticket";

interface PendingTicket extends SubscriptionTicketGrant {
  expiresAtMs: number;
}

export function hashSubscriptionTicket(ticket: string): string {
  return crypto.createHash("sha256").update(ticket).digest("hex");
}

/**
 * Short-lived, single-use credentials for EventSource subscriptions, which cannot send headers.
 * Tickets live in process memory and are keyed by their SHA-256 hash, so the raw value is never stored.
 */
export class SubscriptionTicketService {
  private readonly pending = new Map<string, PendingTicket>();
  private readonly now: () => number;

  constructor(private readonly options: SubscriptionTicketServiceOptions) {
    if (!Number.isInteger(options.ttlMs) || options.ttlMs < MIN_TTL_MS || options.ttlMs > MAX_TTL_MS) {
      throw new Error("Subscription ticket TTL must be between 30 and 60 seconds");
    }

    if (!Number.isInteger(options.maxPendingTickets) || options.maxPendingTickets < 1) {
      throw new Error("maxPendingTickets must be a positive integer");
    }

    this.now = options.now ?? Date.now;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  issue(grant: SubscriptionTicketGrant): IssuedSubscriptionTicket {
    const issuedAtMs = this.now();
    this.purgeExpired(issuedAtMs);

    if (this.pending.size >= this.options.maxPendingTickets) {
      throw new Error("Too many pending subscription tickets");
    }

    const ticket = crypto.randomBytes(32).toString("base64url");
    const expiresAtMs = issuedAtMs + this.options.ttlMs;

    this.pending.set(hashSubscriptionTicket(ticket), {
      boardId: grant.boardId,
      event: grant.event,
      shareTokenHash: grant.shareTokenHash,
      revalidateSession: grant.revalidateSession,
      expiresAtMs,
    });

    return { ticket, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  /** The ticket is consumed by the first redemption attempt, whether or not it matches. */
  redeem(
    ticket: string,
    expected: { boardId: string; event: SubscriptionEventName }
  ): SubscriptionTicketGrant {
    const key = hashSubscriptionTicket(ticket);
    const stored = this.pending.get(key);
    this.pending.delete(key);

    if (!stored || this.now() >= stored.expiresAtMs) {
      throw new Error(INVALID_TICKET_MESSAGE);
    }

    if (stored.boardId !== expected.boardId || stored.event !== expected.event) {
      throw new Error(INVALID_TICKET_MESSAGE);
    }

    return {
      boardId: stored.boardId,
      event: stored.event,
      shareTokenHash: stored.shareTokenHash,
      revalidateSession: stored.revalidateSession,
    };
  }

  purgeExpired(nowMs: number = this.now()): number {
    let removed = 0;

    for (const [key, entry] of this.pending) {
      if (nowMs >= entry.expiresAtMs) {
        this.pending.delete(key);
        removed += 1;
      }
    }

    return removed;
  }
}
