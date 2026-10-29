import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import type { Db } from "./db/client.js";
import { registerAuth } from "./auth/plugin.js";
import { registerSecurity } from "./security.js";
import { authRoutes } from "./routes/auth.js";
import { ticketRoutes, type Clock } from "./routes/tickets.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { createSuggester, type Suggester } from "./ai/suggest.js";

// The app is built from a database (and a clock) passed in, instead of creating its own.
// Tests use a fresh in-memory database and a fake clock to simulate time passing.
export async function buildApp(
  db: Db,
  opts: {
    jwtSecret: string;
    logger?: boolean;
    now?: Clock;
    suggester?: Suggester;
    demo?: boolean;
    webDir?: string;
    // proxies in front of the app (three on Render), so req.ip is the visitor and not
    // the proxy; rate limits are counted per req.ip
    trustProxy?: number | false;
  },
) {
  const app = Fastify({
    logger: opts.logger ?? false,
    // trust only the given number of hops, so a visitor cannot fake their IP in X-Forwarded-For
    trustProxy: opts.trustProxy ? (_address: string, hop: number) => hop < (opts.trustProxy as number) : false,
    // the web app calls /api/...; in development Vite strips the prefix, in
    // production (one service serving both) this does the same
    rewriteUrl: (req) => (req.url ?? "/").replace(/^\/api(?=\/|$)/, "") || "/",
  });
  const now = opts.now ?? (() => new Date());
  const suggester = opts.suggester ?? createSuggester();
  await registerSecurity(app);
  await registerAuth(app, opts.jwtSecret);

  app.get("/health", async () => ({ ok: true, ai: suggester.mode }));
  authRoutes(app, db, { demo: opts.demo });

  // register() creates encapsulated scopes: the auth hook added inside each
  // group protects only that group, not /health or /auth/*.
  await app.register(async (scope) => ticketRoutes(scope, db, now, suggester));
  await app.register(async (scope) => dashboardRoutes(scope, db, now));

  // Production: also serve the built web app, so one service runs everything.
  if (opts.webDir) {
    await app.register(fastifyStatic, { root: opts.webDir, wildcard: false });
    // client-side routes (/tickets/123) get index.html; unknown API calls stay JSON 404s
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && req.headers.accept?.includes("text/html")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "Not found" });
    });
  }

  return app;
}
