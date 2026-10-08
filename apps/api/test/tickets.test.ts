import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDb, type Db } from "../src/db/client.js";
import { organizations } from "../src/db/schema.js";

let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof buildApp>;
let orgA: string;
let orgB: string;

// Every test gets a brand-new in-memory PostgreSQL: no shared state between tests.
beforeEach(async () => {
  ({ db, close } = await createDb());
  app = buildApp(db);
  const rows = await db.insert(organizations).values([{ name: "Acme" }, { name: "Globex" }]).returning();
  orgA = rows[0].id;
  orgB = rows[1].id;
});

afterEach(async () => {
  await app.close();
  await close();
});

const create = (org: string, body: object) =>
  app.inject({ method: "POST", url: "/tickets", headers: { "x-organization-id": org }, payload: body });

describe("tickets", () => {
  it("creates a ticket with default status and priority", async () => {
    const res = await create(orgA, { title: "Printer offline", description: "Office printer does not respond" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ title: "Printer offline", status: "open", priority: "medium", organizationId: orgA });
  });

  it("rejects invalid input", async () => {
    const res = await create(orgA, { title: "x", description: "", priority: "whenever" });
    expect(res.statusCode).toBe(400);
  });

  it("requires an organization", async () => {
    const res = await app.inject({ method: "GET", url: "/tickets" });
    expect(res.statusCode).toBe(401);
  });

  it("lists only the tickets of the caller's organization", async () => {
    await create(orgA, { title: "Ticket from A", description: "a" });
    await create(orgB, { title: "Ticket from B", description: "b" });
    const res = await app.inject({ method: "GET", url: "/tickets", headers: { "x-organization-id": orgA } });
    expect(res.json().map((t: { title: string }) => t.title)).toEqual(["Ticket from A"]);
  });

  it("does not expose another organization's ticket", async () => {
    const created = (await create(orgB, { title: "Secret of B", description: "b" })).json();
    const read = await app.inject({ method: "GET", url: `/tickets/${created.id}`, headers: { "x-organization-id": orgA } });
    const write = await app.inject({
      method: "PATCH",
      url: `/tickets/${created.id}`,
      headers: { "x-organization-id": orgA },
      payload: { status: "closed" },
    });
    expect(read.statusCode).toBe(404);
    expect(write.statusCode).toBe(404);
  });

  it("updates status and filters by it", async () => {
    const created = (await create(orgA, { title: "VPN down", description: "cannot connect", priority: "urgent" })).json();
    const upd = await app.inject({
      method: "PATCH",
      url: `/tickets/${created.id}`,
      headers: { "x-organization-id": orgA },
      payload: { status: "in_progress" },
    });
    expect(upd.json().status).toBe("in_progress");
    const list = await app.inject({ method: "GET", url: "/tickets?status=in_progress", headers: { "x-organization-id": orgA } });
    expect(list.json()).toHaveLength(1);
  });
});
