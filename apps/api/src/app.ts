import Fastify from "fastify";
import type { Db } from "./db/client.js";
import { registerAuth } from "./auth/plugin.js";
import { authRoutes } from "./routes/auth.js";
import { ticketRoutes } from "./routes/tickets.js";

// The app is built from a database passed in, instead of creating its own.
// That lets tests run against a fresh in-memory database every time.
export async function buildApp(db: Db, opts: { jwtSecret: string; logger?: boolean }) {
  const app = Fastify({ logger: opts.logger ?? false });
  await registerAuth(app, opts.jwtSecret);

  app.get("/health", async () => ({ ok: true }));
  authRoutes(app, db);

  // register() creates an encapsulated scope: the auth hook added inside
  // ticketRoutes protects only these routes, not /health or /auth/*.
  await app.register(async (scope) => ticketRoutes(scope, db));

  return app;
}
