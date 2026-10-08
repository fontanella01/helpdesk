import Fastify from "fastify";
import type { Db } from "./db/client.js";
import { ticketRoutes } from "./routes/tickets.js";

// The app is built from a database passed in, instead of creating its own.
// That lets tests run against a fresh in-memory database every time.
export function buildApp(db: Db, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });

  app.get("/health", async () => ({ ok: true }));
  ticketRoutes(app, db);

  return app;
}
