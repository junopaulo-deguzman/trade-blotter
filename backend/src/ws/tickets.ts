import { randomBytes } from "node:crypto";

const tickets = new Map<string, { tokenHash: string; expiresAt: number }>();
const ttl = 30_000;
export function issueTicket(tokenHash: string): { ticket: string; expiresAt: string } {
  const now = Date.now();
  for (const [key, value] of tickets) if (value.expiresAt <= now) tickets.delete(key);
  if (tickets.size >= 1000) throw new Error("WebSocket ticket capacity reached");
  const ticket = randomBytes(32).toString("base64url");
  const expiresAt = now + ttl;
  tickets.set(ticket, { tokenHash, expiresAt });
  return { ticket, expiresAt: new Date(expiresAt).toISOString() };
}
export function consumeTicket(ticket: string): string | undefined {
  const value = tickets.get(ticket);
  tickets.delete(ticket);
  return value && value.expiresAt > Date.now() ? value.tokenHash : undefined;
}
