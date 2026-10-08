import Fastify from "fastify";
import type { Db } from "./db/client.js";
import { registerAuth } from "./auth/plugin.js";
import { authRoutes } from "./routes/auth.js";
import { ticketRoutes, type Clock } from "./routes/tickets.js";
import { dashboardRoutes } from "./routes/dashboard.js";

// The app is built from a database (and a clock) passed in, instead of creating its own.
// Tests use a fresh in-memory database and a fake clock to simulate time passing.
export async function buildApp(db: Db, opts: { jwtSecret: string; logger?: boolean; now?: Clock }) {
  const app = Fastify({ logger: opts.logger ?? false });
  const now = opts.now ?? (() => new Date());
  await registerAuth(app, opts.jwtSecret);

  app.get("/health", async () => ({ ok: true }));
  authRoutes(app, db);

  // register() creates encapsulated scopes: the auth hook added inside each
  // group protects only that group, not /health or /auth/*.
  await app.register(async (scope) => ticketRoutes(scope, db, now));
  await app.register(async (scope) => dashboardRoutes(scope, db, now));

  return app;
}
