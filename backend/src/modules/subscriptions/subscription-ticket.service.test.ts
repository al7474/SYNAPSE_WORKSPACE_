import assert from "node:assert/strict";
import test from "node:test";
import {
  hashSubscriptionTicket,
  SubscriptionTicketService,
} from "./subscription-ticket.service.js";

const TTL_MS = 45_000;
const INVALID_MESSAGE = /Invalid or expired subscription ticket/;

function createClock(startMs = 1_000_000) {
  let current = startMs;

  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function createService(options: { maxPendingTickets?: number } = {}) {
  const clock = createClock();
  const service = new SubscriptionTicketService({
    ttlMs: TTL_MS,
    maxPendingTickets: options.maxPendingTickets ?? 100,
    now: clock.now,
  });

  return { clock, service };
}

const revalidateSession = async () => true;

function grantFor(boardId: string, event: "noteUpdated" | "noteDeleted" = "noteUpdated") {
  return { boardId, event, shareTokenHash: "a".repeat(64), revalidateSession };
}

test("redeems a ticket once for the board and event it was issued for", () => {
  const { service } = createService();
  const issued = service.issue(grantFor("7"));

  const grant = service.redeem(issued.ticket, { boardId: "7", event: "noteUpdated" });

  assert.equal(grant.boardId, "7");
  assert.equal(grant.event, "noteUpdated");
  assert.equal(grant.shareTokenHash, "a".repeat(64));
  assert.equal(grant.revalidateSession, revalidateSession);
  assert.throws(
    () => service.redeem(issued.ticket, { boardId: "7", event: "noteUpdated" }),
    INVALID_MESSAGE
  );
});

test("accepts a ticket up to the last millisecond before it expires", () => {
  const { clock, service } = createService();
  const issued = service.issue(grantFor("7"));

  clock.advance(TTL_MS - 1);

  assert.doesNotThrow(() => service.redeem(issued.ticket, { boardId: "7", event: "noteUpdated" }));
});

test("rejects a ticket at its exact expiry instant and removes it", () => {
  const { clock, service } = createService();
  const issued = service.issue(grantFor("7"));

  clock.advance(TTL_MS);

  assert.throws(
    () => service.redeem(issued.ticket, { boardId: "7", event: "noteUpdated" }),
    INVALID_MESSAGE
  );
  assert.equal(service.pendingCount, 0);
});

test("reports the expiry instant to the caller", () => {
  const { clock, service } = createService();
  const issued = service.issue(grantFor("7"));

  assert.equal(issued.expiresAt, new Date(clock.now() + TTL_MS).toISOString());
});

test("rejects a ticket presented for another board or event and consumes it", () => {
  const { service } = createService();
  const issued = service.issue(grantFor("7", "noteUpdated"));

  assert.throws(
    () => service.redeem(issued.ticket, { boardId: "8", event: "noteUpdated" }),
    INVALID_MESSAGE
  );
  assert.throws(
    () => service.redeem(issued.ticket, { boardId: "7", event: "noteUpdated" }),
    INVALID_MESSAGE
  );
});

test("rejects a ticket issued for noteUpdated when redeemed for noteDeleted", () => {
  const { service } = createService();
  const issued = service.issue(grantFor("7", "noteUpdated"));

  assert.throws(
    () => service.redeem(issued.ticket, { boardId: "7", event: "noteDeleted" }),
    INVALID_MESSAGE
  );
});

test("rejects unknown tickets and does not accept the stored hash as a credential", () => {
  const { service } = createService();
  const issued = service.issue(grantFor("7"));
  const storedHash = hashSubscriptionTicket(issued.ticket);

  assert.throws(
    () => service.redeem("unknown-ticket", { boardId: "7", event: "noteUpdated" }),
    INVALID_MESSAGE
  );
  assert.throws(
    () => service.redeem(storedHash, { boardId: "7", event: "noteUpdated" }),
    INVALID_MESSAGE
  );
  assert.doesNotThrow(() => service.redeem(issued.ticket, { boardId: "7", event: "noteUpdated" }));
});

test("generates unpredictable 256-bit base64url tickets", () => {
  const { service } = createService();
  const first = service.issue(grantFor("7"));
  const second = service.issue(grantFor("7"));

  assert.match(first.ticket, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.ticket, second.ticket);
});

test("stores only SHA-256 hashes of tickets", () => {
  assert.match(hashSubscriptionTicket("example-ticket"), /^[a-f0-9]{64}$/);
  assert.equal(
    hashSubscriptionTicket("example-ticket"),
    hashSubscriptionTicket("example-ticket")
  );
});

test("validates the ticket TTL stays between 30 and 60 seconds", () => {
  assert.throws(
    () => new SubscriptionTicketService({ ttlMs: 29_999, maxPendingTickets: 1 }),
    /between 30 and 60 seconds/
  );
  assert.throws(
    () => new SubscriptionTicketService({ ttlMs: 60_001, maxPendingTickets: 1 }),
    /between 30 and 60 seconds/
  );
  assert.doesNotThrow(() => new SubscriptionTicketService({ ttlMs: 30_000, maxPendingTickets: 1 }));
  assert.doesNotThrow(() => new SubscriptionTicketService({ ttlMs: 60_000, maxPendingTickets: 1 }));
});

test("purges expired tickets and frees capacity for new ones", () => {
  const { clock, service } = createService({ maxPendingTickets: 2 });

  service.issue(grantFor("1"));
  service.issue(grantFor("2"));
  assert.throws(() => service.issue(grantFor("3")), /Too many pending subscription tickets/);

  clock.advance(TTL_MS);
  service.issue(grantFor("3"));

  assert.equal(service.pendingCount, 1);
});

test("purgeExpired reports how many tickets it removed", () => {
  const { clock, service } = createService();

  service.issue(grantFor("1"));
  service.issue(grantFor("2"));
  clock.advance(TTL_MS);

  assert.equal(service.purgeExpired(), 2);
  assert.equal(service.pendingCount, 0);
});
