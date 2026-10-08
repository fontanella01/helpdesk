import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { tickets, TICKET_PRIORITIES, TICKET_STATUSES } from "../db/schema.js";

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
  })
  .refine((v) => v.status !== undefined || v.priority !== undefined, { message: "Nothing to update" });

const listQuery = z.object({ status: z.enum(TICKET_STATUSES).optional() });
const idParam = z.object({ id: z.uuid() });

// Every route requires a valid token. The organization always comes from the
// token (req.user.org), never from the request body, query or headers.
export function ticketRoutes(app: FastifyInstance, db: Db) {
  app.addHook("preHandler", app.authenticate);

  app.get("/tickets", async (req, reply) => {
    const org = req.user.org;
    const q = listQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: z.prettifyError(q.error) });

    const where = q.data.status
      ? and(eq(tickets.organizationId, org), eq(tickets.status, q.data.status))
      : eq(tickets.organizationId, org);
    return db.select().from(tickets).where(where).orderBy(desc(tickets.createdAt));
  });

  app.post("/tickets", async (req, reply) => {
    const org = req.user.org;
    const body = createSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    const [created] = await db
      .insert(tickets)
      .values({ ...body.data, organizationId: org, createdBy: req.user.sub })
      .returning();
    return reply.code(201).send(created);
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
    return ticket;
  });

  app.patch("/tickets/:id", async (req, reply) => {
    const org = req.user.org;
    const params = idParam.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: "Ticket not found" });
    const body = updateSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    const [updated] = await db
      .update(tickets)
      .set({ ...body.data, updatedAt: new Date() })
      .where(and(eq(tickets.id, params.data.id), eq(tickets.organizationId, org)))
      .returning();
    if (!updated) return reply.code(404).send({ error: "Ticket not found" });
    return updated;
  });
}
