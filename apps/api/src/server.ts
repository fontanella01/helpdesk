import { buildApp } from "./app.js";
import { createDb } from "./db/client.js";
import { resetData, seedDemo } from "./demo.js";
import { createSuggester, demoSuggester } from "./ai/suggest.js";
import { withDailyLimit } from "./ai/budget.js";

// Local settings from apps/api/.env (copy .env.example). Real environment variables win.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file: rely on the environment
}

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  console.error("Set JWT_SECRET (at least 32 random characters) before starting the API.");
  process.exit(1);
}

const { db } = await createDb({
  url: process.env.DATABASE_URL,
  // local development without a Postgres server: data kept in apps/api/.data
  dataDir: process.env.DATABASE_URL ? undefined : "./.data",
});

const demo = process.env.DEMO_MODE === "true";
// A daily cap on AI suggestions (AI_DAILY_LIMIT; 200 by default on the public demo),
// so visitors cannot run up the API bill. Past it, the free keyword rules answer.
const aiLimit = process.env.AI_DAILY_LIMIT ? Number(process.env.AI_DAILY_LIMIT) : demo ? 200 : Infinity;
const baseSuggester = createSuggester();
const suggester = baseSuggester.mode === "ai" ? withDailyLimit(baseSuggester, demoSuggester, aiLimit, () => new Date()) : baseSuggester;
const app = await buildApp(db, {
  jwtSecret,
  logger: true,
  demo,
  suggester,
  webDir: process.env.WEB_DIR,
  trustProxy: process.env.TRUST_PROXY_HOPS ? Number(process.env.TRUST_PROXY_HOPS) : false,
});
// the sample company behind the "Try the demo" button
if (demo && process.env.DEMO_RESET_ON_START === "true") await resetData(db);
if (demo) await seedDemo(app, db);
const port = Number(process.env.PORT ?? 3333);
await app.listen({ port, host: "0.0.0.0" });
