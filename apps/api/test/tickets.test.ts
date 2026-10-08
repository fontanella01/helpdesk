import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
let tokenA: string;
let tokenB: string;

beforeEach(async () => {
  ctx = await setup();
  tokenA = (await ctx.register("Acme", "owner@acme.com")).token;
  tokenB = (await ctx.register("Globex", "owner@globex.com")).token;
});

afterEach(() => ctx.teardown());

const create = (token: string, body: object) =>
  ctx.app.inject({ method: "POST", url: "/tickets", headers: ctx.auth(token), payload: body });

describe("tickets", () => {
  it("creates a ticket with default status and priority, recording who opened it", async () => {
    const me = (await ctx.app.inject({ method: "GET", url: "/auth/me", headers: ctx.auth(tokenA) })).json();
    const res = await create(tokenA, { title: "Printer offline", description: "Office printer does not respond" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ title: "Printer offline", status: "open", priority: "medium", createdBy: me.id });
  });

  it("rejects invalid input", async () => {
    const res = await create(tokenA, { title: "x", description: "", priority: "whenever" });
    expect(res.statusCode).toBe(400);
  });

  it("requires a valid token", async () => {
    const none = await ctx.app.inject({ method: "GET", url: "/tickets" });
    const forged = await ctx.app.inject({ method: "GET", url: "/tickets", headers: { authorization: "Bearer not.a.token" } });
    expect(none.statusCode).toBe(401);
    expect(forged.statusCode).toBe(401);
  });

  it("ignores any organization sent by the client", async () => {
    const orgB = (await ctx.app.inject({ method: "GET", url: "/auth/me", headers: ctx.auth(tokenB) })).json().organizationId;
    const res = await create(tokenA, { title: "Sneaky ticket", description: "x", organizationId: orgB });
    const listB = await ctx.app.inject({ method: "GET", url: "/tickets", headers: ctx.auth(tokenB) });
    expect(res.statusCode).toBe(201);
    expect(listB.json()).toHaveLength(0);
  });

  it("lists only the tickets of the caller's organization", async () => {
    await create(tokenA, { title: "Ticket from A", description: "a" });
    await create(tokenB, { title: "Ticket from B", description: "b" });
    const res = await ctx.app.inject({ method: "GET", url: "/tickets", headers: ctx.auth(tokenA) });
    expect(res.json().map((t: { title: string }) => t.title)).toEqual(["Ticket from A"]);
  });

  it("does not expose another organization's ticket", async () => {
    const created = (await create(tokenB, { title: "Secret of B", description: "b" })).json();
    const read = await ctx.app.inject({ method: "GET", url: `/tickets/${created.id}`, headers: ctx.auth(tokenA) });
    const write = await ctx.app.inject({
      method: "PATCH",
      url: `/tickets/${created.id}`,
      headers: ctx.auth(tokenA),
      payload: { status: "closed" },
    });
    expect(read.statusCode).toBe(404);
    expect(write.statusCode).toBe(404);
  });

  it("updates status and filters by it", async () => {
    const created = (await create(tokenA, { title: "VPN down", description: "cannot connect", priority: "urgent" })).json();
    const upd = await ctx.app.inject({
      method: "PATCH",
      url: `/tickets/${created.id}`,
      headers: ctx.auth(tokenA),
      payload: { status: "in_progress" },
    });
    expect(upd.json().status).toBe("in_progress");
    const list = await ctx.app.inject({ method: "GET", url: "/tickets?status=in_progress", headers: ctx.auth(tokenA) });
    expect(list.json()).toHaveLength(1);
  });
});
