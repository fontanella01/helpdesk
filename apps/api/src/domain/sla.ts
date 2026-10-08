import type { TicketPriority, TicketStatus } from "../db/schema.js";

// Business rule: how long the team has to resolve a ticket, by priority.
// Kept as pure functions (no database, no clock inside) so they are trivial to test.
export const SLA_HOURS: Record<TicketPriority, number> = {
  urgent: 4,
  high: 8,
  medium: 24,
  low: 72,
};

const HOUR = 60 * 60 * 1000;

export function dueAt(createdAt: Date, priority: TicketPriority): Date {
  return new Date(createdAt.getTime() + SLA_HOURS[priority] * HOUR);
}

export const isDone = (status: TicketStatus) => status === "resolved" || status === "closed";

// A ticket is overdue while it is not done and its due date has passed.
export function isOverdue(t: { status: TicketStatus; dueAt: Date }, now: Date): boolean {
  return !isDone(t.status) && t.dueAt.getTime() < now.getTime();
}

// resolved_at follows the status: set when the ticket is done, cleared if reopened.
export function nextResolvedAt(current: Date | null, nextStatus: TicketStatus, now: Date): Date | null {
  if (!isDone(nextStatus)) return null;
  return current ?? now;
}
