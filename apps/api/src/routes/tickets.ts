import type { FastifyInstance } from "fastify";
import Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, inArray, isNull, lt, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import {
  ticketComments,
  ticketEvents,
  tickets,
  users,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type Ticket,
  type TicketEventType,
} from "../db/schema.js";
import type { Suggester } from "../ai/suggest.js";
import { dueAt, isOverdue, nextResolvedAt } from "../domain/sla.js";

// Request validation lives at the edge: anything invalid is rejected with 400
// before touching the database.
const createSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(1).max(10_000),
  priority: z.enum(TICKET_PRIORITIES).default("medium"),
  assigneeId: z.uuid().nullable().optional(),
});

const updateSchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    category: z.enum(TICKET_CATEGORIES).nullable().optional(),
    assigneeId: z.uuid().nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update" });

const commentSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  internal: z.boolean().default(false),
});

const listQuery = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  overdue: z.enum(["true"]).optional(),
  sort: z.enum(["newest", "due"]).default("newest"),
  // "me", "none" (unassigned) or a user id
  assignee: z.union([z.literal("me"), z.literal("none"), z.uuid()]).optional(),
});
const idParam = z.object({ id: z.uuid() });

export type Clock = () => Date;

// The API always answers with an `overdue` flag computed with the same clock the rules use.
const withSla = (t: Ticket, now: Date) => ({ ...t, overdue: isOverdue(t, now) });

type EventRow = { type: TicketEventType; fromValue: string | null; toValue: string | null };

// Fields whose changes go to the ticket history, compared before and after an update.
const TRACKED = [
  ["status", "status"],
  ["priority", "priority"],
  ["category", "category"],
  ["assignee", "assigneeId"],
] as const;

function changes(before: Ticket, after: Ticket): EventRow[] {
  return TRACKED.filter(([, key]) => before[key] !== after[key]).map(([type, key]) => ({
    type,
    fromValue: before[key],
    toValue: after[key],
  }));
}

// Every route requires a valid token. The organization always comes from the
// token (req.user.org), never from the request body, query or headers.
export function ticketRoutes(app: FastifyInstance, db: Db, now: Clock, suggester: Suggester) {
  app.addHook("preHandler", app.authenticate);

  // An assignee must be a user of the same organization. Checked here, because a
  // foreign key alone would accept a user id from another tenant.
  const isMember = async (org: string, userId: string) => {
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, org)));
    return Boolean(u);
  };

  const findTicket = async (org: string, id: string) => {
    const [t] = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, id), eq(tickets.organizationId, org)));
    return t;
  };

  app.get("/tickets", async (req, reply) => {
    const org = req.user.org;
    const q = listQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: z.prettifyError(q.error) });

    const t = now();
    const filters: SQL[] = [eq(tickets.organizationId, org)];
    if (q.data.status) filters.push(eq(tickets.status, q.data.status));
    if (q.data.assignee === "me") filters.push(eq(tickets.assigneeId, req.user.sub));
    else if (q.data.assignee === "none") filters.push(isNull(tickets.assigneeId));
    else if (q.data.assignee) filters.push(eq(tickets.assigneeId, q.data.assignee));
    if (q.data.overdue) {
      filters.push(isNull(tickets.resolvedAt), lt(tickets.dueAt, t), inArray(tickets.status, ["open", "in_progress", "waiting_customer"]));
    }
    const order = q.data.sort === "due" ? asc(tickets.dueAt) : desc(tickets.createdAt);
    const rows = await db.select().from(tickets).where(and(...filters)).orderBy(order);
    return rows.map((r) => withSla(r, t));
  });

  app.post("/tickets", async (req, reply) => {
    const org = req.user.org;
    const body = createSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    if (body.data.assigneeId && !(await isMember(org, body.data.assigneeId))) {
      return reply.code(400).send({ error: "Assignee must be a member of your organization" });
    }

    const t = now();
    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(tickets)
        .values({ ...body.data, organizationId: org, createdBy: req.user.sub, createdAt: t, updatedAt: t, dueAt: dueAt(t, body.data.priority) })
        .returning();
      await tx.insert(ticketEvents).values({ organizationId: org, ticketId: row.id, actorId: req.user.sub, type: "created", createdAt: t });
      return row;
    });
    return reply.code(201).send(withSla(created, t));
  });

  app.get("/tickets/:id", async (req, reply) => {
    const org = req.user.org;
    const params = idParam.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: "Ticket not found" });

    // Filtering by organization too: a ticket from another tenant behaves as "not found".
    const [ticket] = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, params.data.id), eq(tickets.organizationId, org)));
    if (!ticket) return reply.code(404).send({ error: "Ticket not found" });
    return withSla(ticket, now());
  });

  app.patch("/tickets/:id", async (req, reply) => {
    const org = req.user.org;
    const params = idParam.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: "Ticket not found" });
    const body = updateSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    const where = and(eq(tickets.id, params.data.id), eq(tickets.organizationId, org));
    const current = await findTicket(org, params.data.id);
    if (!current) return reply.code(404).send({ error: "Ticket not found" });
    if (body.data.assigneeId && !(await isMember(org, body.data.assigneeId))) {
      return reply.code(400).send({ error: "Assignee must be a member of your organization" });
    }

    const t = now();
    const priority = body.data.priority ?? current.priority;
    const status = body.data.status ?? current.status;
    // the update and its history entries are saved together or not at all
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(tickets)
        .set({
          status,
          priority,
          // a new priority means a new deadline, still counted from when the ticket was opened
          dueAt: priority !== current.priority ? dueAt(current.createdAt, priority) : current.dueAt,
          resolvedAt: nextResolvedAt(current.resolvedAt, status, t),
          category: body.data.category === undefined ? current.category : body.data.category,
          assigneeId: body.data.assigneeId === undefined ? current.assigneeId : body.data.assigneeId,
          updatedAt: t,
        })
        .where(where)
        .returning();
      const events = changes(current, row);
      if (events.length) {
        await tx
          .insert(ticketEvents)
          .values(events.map((e) => ({ ...e, organizationId: org, ticketId: row.id, actorId: req.user.sub, createdAt: t })));
      }
      return row;
    });
    return withSla(updated, t);
  });

  // Replies to the customer and internal notes, in the order they were written.
  app.post("/tickets/:id/comments", async (req, reply) => {
    const org = req.user.org;
    const params = idParam.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: "Ticket not found" });
    const body = commentSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });
    if (!(await findTicket(org, params.data.id))) return reply.code(404).send({ error: "Ticket not found" });

    const t = now();
    const comment = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(ticketComments)
        .values({ ...body.data, organizationId: org, ticketId: params.data.id, authorId: req.user.sub, createdAt: t })
        .returning();
      await tx.update(tickets).set({ updatedAt: t }).where(eq(tickets.id, params.data.id));
      return row;
    });
    const [author] = await db.select({ name: users.name }).from(users).where(eq(users.id, req.user.sub));
    return reply.code(201).send({ ...comment, authorName: author?.name ?? null });
  });

  // Comments and history merged into one timeline, oldest first.
  app.get("/tickets/:id/timeline", async (req, reply) => {
    const org = req.user.org;
    const params = idParam.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: "Ticket not found" });
    if (!(await findTicket(org, params.data.id))) return reply.code(404).send({ error: "Ticket not found" });

    const comments = await db
      .select({
        id: ticketComments.id,
        body: ticketComments.body,
        internal: ticketComments.internal,
        createdAt: ticketComments.createdAt,
        authorName: users.name,
      })
      .from(ticketComments)
      .leftJoin(users, eq(users.id, ticketComments.authorId))
      .where(and(eq(ticketComments.ticketId, params.data.id), eq(ticketComments.organizationId, org)));

    const events = await db
      .select({
        id: ticketEvents.id,
        type: ticketEvents.type,
        fromValue: ticketEvents.fromValue,
        toValue: ticketEvents.toValue,
        createdAt: ticketEvents.createdAt,
        authorName: users.name,
      })
      .from(ticketEvents)
      .leftJoin(users, eq(users.id, ticketEvents.actorId))
      .where(and(eq(ticketEvents.ticketId, params.data.id), eq(ticketEvents.organizationId, org)));

    return [
      ...comments.map((c) => ({ kind: "comment" as const, ...c })),
      ...events.map((e) => ({ kind: "event" as const, ...e })),
    ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  });

  // Asks the assistant for a category, priority and draft reply. Read-only:
  // the agent decides what to apply (PATCH) and what to send to the customer.
  app.post("/tickets/:id/suggest", async (req, reply) => {
    const params = idParam.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: "Ticket not found" });
    const [ticket] = await db
      .select()
      .from(tickets)
      .where(and(eq(tickets.id, params.data.id), eq(tickets.organizationId, req.user.org)));
    if (!ticket) return reply.code(404).send({ error: "Ticket not found" });

    try {
      return await suggester.suggest({ title: ticket.title, description: ticket.description });
    } catch (err) {
      // Provider problems become a clear 503 for the UI; details stay in the server log.
      req.log.error({ err }, "AI suggestion failed");
      const status = err instanceof Anthropic.RateLimitError ? 429 : 503;
      return reply.code(status).send({ error: "The assistant is unavailable right now. Try again in a moment." });
    }
  });
}
