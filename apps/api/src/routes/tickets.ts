import type { FastifyInstance } from "fastify";
import Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, inArray, isNull, lt, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { tickets, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, type Ticket } from "../db/schema.js";
import type { Suggester } from "../ai/suggest.js";
import { dueAt, isOverdue, nextResolvedAt } from "../domain/sla.js";

// Request validation lives at the edge: anything invalid is rejected with 400
// before touching the database.
const createSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(1).max(10_000),
  priority: z.enum(TICKET_PRIORITIES).default("medium"),
});

const updateSchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    category: z.enum(TICKET_CATEGORIES).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.priority !== undefined || v.category !== undefined, { message: "Nothing to update" });

const listQuery = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  overdue: z.enum(["true"]).optional(),
  sort: z.enum(["newest", "due"]).default("newest"),
});
const idParam = z.object({ id: z.uuid() });

export type Clock = () => Date;

// The API always answers with an `overdue` flag computed with the same clock the rules use.
const withSla = (t: Ticket, now: Date) => ({ ...t, overdue: isOverdue(t, now) });

// Every route requires a valid token. The organization always comes from the
// token (req.user.org), never from the request body, query or headers.
export function ticketRoutes(app: FastifyInstance, db: Db, now: Clock, suggester: Suggester) {
  app.addHook("preHandler", app.authenticate);

  app.get("/tickets", async (req, reply) => {
    const org = req.user.org;
    const q = listQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: z.prettifyError(q.error) });

    const t = now();
    const filters: SQL[] = [eq(tickets.organizationId, org)];
    if (q.data.status) filters.push(eq(tickets.status, q.data.status));
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

    const t = now();
    const [created] = await db
      .insert(tickets)
      .values({ ...body.data, organizationId: org, createdBy: req.user.sub, createdAt: t, updatedAt: t, dueAt: dueAt(t, body.data.priority) })
      .returning();
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
    const [current] = await db.select().from(tickets).where(where);
    if (!current) return reply.code(404).send({ error: "Ticket not found" });

    const t = now();
    const priority = body.data.priority ?? current.priority;
    const status = body.data.status ?? current.status;
    const [updated] = await db
      .update(tickets)
      .set({
        status,
        priority,
        // a new priority means a new deadline, still counted from when the ticket was opened
        dueAt: priority !== current.priority ? dueAt(current.createdAt, priority) : current.dueAt,
        resolvedAt: nextResolvedAt(current.resolvedAt, status, t),
        category: body.data.category === undefined ? current.category : body.data.category,
        updatedAt: t,
      })
      .where(where)
      .returning();
    return withSla(updated, t);
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
