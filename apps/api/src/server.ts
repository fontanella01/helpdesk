import { buildApp } from "./app.js";
import { createDb } from "./db/client.js";

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

const app = await buildApp(db, { jwtSecret, logger: true });
const port = Number(process.env.PORT ?? 3333);
await app.listen({ port, host: "0.0.0.0" });
