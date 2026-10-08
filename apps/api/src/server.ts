import { buildApp } from "./app.js";
import { createDb } from "./db/client.js";

const { db } = await createDb({
  url: process.env.DATABASE_URL,
  // local development without a Postgres server: data kept in apps/api/.data
  dataDir: process.env.DATABASE_URL ? undefined : "./.data",
});

const app = buildApp(db, { logger: true });
const port = Number(process.env.PORT ?? 3333);
await app.listen({ port, host: "0.0.0.0" });
