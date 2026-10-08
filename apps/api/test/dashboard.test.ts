import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
let token: string;

beforeEach(async () => {
  ctx = await setup();
  token = (await ctx.register("Acme", "owner@acme.com")).token;
});

afterEach(() => ctx.teardown());

const create = async (title: string, priority: string) =>
  (await ctx.app.inject({ method: "POST", url: "/tickets", headers: ctx.auth(token), payload: { title, description: "x", priority } })).json();
const patch = (id: string, payload: object) =>
  ctx.app.inject({ method: "PATCH", url: `/tickets/${id}`, headers: ctx.auth(token), payload });
const get = (url: string) => ctx.app.inject({ method: "GET", url, headers: ctx.auth(token) });

describe("SLA on tickets", () => {
  it("sets the due date from the priority and flags overdue tickets", async () => {
    const t = await create("Server down", "urgent");
    expect(new Date(t.dueAt).getTime() - new Date(t.createdAt).getTime()).toBe(4 * 3_600_000);
    expect(t.overdue).toBe(false);

    ctx.clock.advance(5);
    expect((await get(`/tickets/${t.id}`)).json().overdue).toBe(true);
    expect((await get("/tickets?overdue=true")).json()).toHaveLength(1);
  });

  it("recalculates the deadline when the priority changes", async () => {
    const t = await create("Slow page", "low");
    const res = (await patch(t.id, { priority: "high" })).json();
    expect(new Date(res.dueAt).getTime() - new Date(t.createdAt).getTime()).toBe(8 * 3_600_000);
  });

  it("stops counting when resolved and restarts when reopened", async () => {
    const t = await create("Bug", "urgent");
    ctx.clock.advance(2);
    const resolved = (await patch(t.id, { status: "resolved" })).json();
    expect(resolved.resolvedAt).not.toBeNull();
    ctx.clock.advance(10);
    expect((await get(`/tickets/${t.id}`)).json().overdue).toBe(false);
    const reopened = (await patch(t.id, { status: "open" })).json();
    expect(reopened.resolvedAt).toBeNull();
    expect(reopened.overdue).toBe(true);
  });
});

describe("dashboard", () => {
  it("summarizes the organization's tickets", async () => {
    const a = await create("Ticket A", "urgent");
    await create("Ticket B", "medium");
    const c = await create("Ticket C", "low");

    ctx.clock.advance(2);
    await patch(c.id, { status: "resolved" }); // resolved in 2h, within its 72h SLA
    ctx.clock.advance(3); // A (urgent, 4h) is now overdue; B (24h) is not

    const d = (await get("/dashboard")).json();
    expect(d).toMatchObject({
      openTotal: 2,
      overdue: 1,
      resolved30d: 1,
      avgResolutionHours: 2,
      onTimeRate30d: 100,
      byStatus: { open: 2, resolved: 1 },
      openByPriority: { urgent: 1, medium: 1 },
    });
    expect(a.id).toBeTruthy();
  });

  it("does not count other organizations' tickets", async () => {
    await create("Mine", "low");
    const other = (await ctx.register("Globex", "owner@globex.com")).token;
    const d = (await ctx.app.inject({ method: "GET", url: "/dashboard", headers: ctx.auth(other) })).json();
    expect(d.openTotal).toBe(0);
  });

  it("requires login", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/dashboard" })).statusCode).toBe(401);
  });
});
