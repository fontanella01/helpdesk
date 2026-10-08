import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { organizations, users } from "../db/schema.js";
import { hashPassword, verifyPassword } from "../auth/password.js";

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const password = z.string().min(8).max(200);

const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  email,
  password,
});
const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
const newUserSchema = z.object({ name: z.string().trim().min(2).max(120), email, password });

// Used when the email does not exist, so a failed login takes about the same
// time either way and does not reveal which emails are registered.
const DUMMY_HASH = await hashPassword("not-a-real-password");

const publicUser = (u: typeof users.$inferSelect) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  organizationId: u.organizationId,
});

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
};

export function authRoutes(app: FastifyInstance, db: Db) {
  // Creates a new organization and its first user (the owner).
  app.post("/auth/register", async (req, reply) => {
    const body = registerSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    const passwordHash = await hashPassword(body.data.password);
    try {
      // both rows or none: no organization without an owner
      const user = await db.transaction(async (tx) => {
        const [org] = await tx.insert(organizations).values({ name: body.data.organizationName }).returning();
        const [owner] = await tx
          .insert(users)
          .values({ organizationId: org.id, name: body.data.name, email: body.data.email, passwordHash, role: "owner" })
          .returning();
        return owner;
      });
      const token = app.jwt.sign({ sub: user.id, org: user.organizationId, role: user.role });
      return reply.code(201).send({ token, user: publicUser(user) });
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: "Email already registered" });
      throw err;
    }
  });

  app.post("/auth/login", async (req, reply) => {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    const [user] = await db.select().from(users).where(eq(users.email, body.data.email));
    const ok = await verifyPassword(body.data.password, user?.passwordHash ?? DUMMY_HASH);
    // same message for "no such email" and "wrong password"
    if (!user || !ok) return reply.code(401).send({ error: "Invalid email or password" });

    const token = app.jwt.sign({ sub: user.id, org: user.organizationId, role: user.role });
    return { token, user: publicUser(user) };
  });

  app.get("/auth/me", { preHandler: app.authenticate }, async (req, reply) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.user.sub));
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    return publicUser(user);
  });

  // The owner adds agents to their own organization.
  app.post("/users", { preHandler: app.authenticate }, async (req, reply) => {
    if (req.user.role !== "owner") return reply.code(403).send({ error: "Only the owner can add users" });
    const body = newUserSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: z.prettifyError(body.error) });

    try {
      const [user] = await db
        .insert(users)
        .values({
          name: body.data.name,
          email: body.data.email,
          passwordHash: await hashPassword(body.data.password),
          organizationId: req.user.org,
          role: "agent",
        })
        .returning();
      return reply.code(201).send(publicUser(user));
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: "Email already registered" });
      throw err;
    }
  });
}
