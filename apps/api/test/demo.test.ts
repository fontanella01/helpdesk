import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDb } from "../src/db/client.js";
import { resetData, seedDemo } from "../src/demo.js";
import { TEST_SECRET } from "./helpers.js";

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

async function start(demo: boolean) {
  const { db, close } = await createDb();
  const app = await buildApp(db, { jwtSecret: TEST_SECRET, demo });
  cleanup = async () => {
    await app.close();
    await close();
  };
  return { app, db };
}

describe("demo mode", () => {
  it("is off unless enabled", async () => {
    const { app } = await start(false);
    expect((await app.inject({ method: "GET", url: "/auth/config" })).json()).toEqual({ demo: false });
    expect((await app.inject({ method: "POST", url: "/auth/demo" })).statusCode).toBe(404);
  });

  it("creates a sample company once and signs visitors into it", async () => {
    const { app, db } = await start(true);
    expect(await seedDemo(app, db)).toBe(true);
    expect(await seedDemo(app, db)).toBe(false);

    const login = await app.inject({ method: "POST", url: "/auth/demo" });
    expect(login.statusCode).toBe(200);
    const auth = { authorization: `Bearer ${login.json().token}` };

    const tickets = (await app.inject({ method: "GET", url: "/tickets", headers: auth })).json();
    expect(tickets.length).toBe(8);
    const dash = (await app.inject({ method: "GET", url: "/dashboard", headers: auth })).json();
    expect(dash.resolved30d).toBe(3);
    expect(dash.openByAssignee.length).toBeGreaterThan(1);

    const outage = tickets.find((t: { title: string }) => t.title.startsWith("Internet down"));
    const timeline = (await app.inject({ method: "GET", url: `/tickets/${outage.id}/timeline`, headers: auth })).json();
    expect(timeline.some((i: { kind: string; internal?: boolean }) => i.kind === "comment" && i.internal)).toBe(true);
  });

  it("starts over from the sample company after a reset", async () => {
    const { app, db } = await start(true);
    await seedDemo(app, db);
    await resetData(db);
    expect(await seedDemo(app, db)).toBe(true);
    const login = await app.inject({ method: "POST", url: "/auth/demo" });
    const list = await app.inject({ method: "GET", url: "/tickets", headers: { authorization: `Bearer ${login.json().token}` } });
    expect(list.json()).toHaveLength(8);
  });

  it("answers the API under /api too, as the web app calls it in production", async () => {
    const { app } = await start(true);
    expect((await app.inject({ method: "GET", url: "/api/health" })).json()).toMatchObject({ ok: true });
  });
});
