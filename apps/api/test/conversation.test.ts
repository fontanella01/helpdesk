import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setup } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
let ownerA: string;
let ownerB: string;
let agentA: { token: string; id: string };

beforeEach(async () => {
  ctx = await setup();
  ownerA = (await ctx.register("Acme", "owner@acme.com")).token;
  ownerB = (await ctx.register("Globex", "owner@globex.com")).token;

  const created = await ctx.app.inject({
    method: "POST",
    url: "/users",
    headers: ctx.auth(ownerA),
    payload: { name: "Ana Agent", email: "ana@acme.com", password: "s3cret-pass" },
  });
  const login = await ctx.app.inject({ method: "POST", url: "/auth/login", payload: { email: "ana@acme.com", password: "s3cret-pass" } });
  agentA = { token: login.json().token, id: created.json().id };
});

afterEach(() => ctx.teardown());

const create = async (token: string, body: object = {}) =>
  (await ctx.app.inject({ method: "POST", url: "/tickets", headers: ctx.auth(token), payload: { title: "VPN is down", description: "Cannot connect", ...body } })).json();

const patch = (token: string, id: string, body: object) =>
  ctx.app.inject({ method: "PATCH", url: `/tickets/${id}`, headers: ctx.auth(token), payload: body });

const timeline = (token: string, id: string) => ctx.app.inject({ method: "GET", url: `/tickets/${id}/timeline`, headers: ctx.auth(token) });

const comment = (token: string, id: string, body: object) =>
  ctx.app.inject({ method: "POST", url: `/tickets/${id}/comments`, headers: ctx.auth(token), payload: body });

describe("team members", () => {
  it("lists only the members of the caller's organization", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/users", headers: ctx.auth(ownerA) });
    expect(res.json().map((u: { email: string }) => u.email).sort()).toEqual(["ana@acme.com", "owner@acme.com"]);
  });
});

describe("assignment", () => {
  it("assigns a ticket and filters by assignee", async () => {
    const assigned = await create(ownerA, { assigneeId: agentA.id });
    const unassigned = await create(ownerA);

    const mine = await ctx.app.inject({ method: "GET", url: "/tickets?assignee=me", headers: ctx.auth(agentA.token) });
    const none = await ctx.app.inject({ method: "GET", url: "/tickets?assignee=none", headers: ctx.auth(agentA.token) });
    expect(mine.json().map((t: { id: string }) => t.id)).toEqual([assigned.id]);
    expect(none.json().map((t: { id: string }) => t.id)).toEqual([unassigned.id]);
  });

  it("reassigns and unassigns", async () => {
    const t = await create(ownerA);
    expect((await patch(ownerA, t.id, { assigneeId: agentA.id })).json().assigneeId).toBe(agentA.id);
    expect((await patch(ownerA, t.id, { assigneeId: null })).json().assigneeId).toBeNull();
  });

  it("refuses an assignee from another organization", async () => {
    const outsider = (await ctx.app.inject({ method: "GET", url: "/auth/me", headers: ctx.auth(ownerB) })).json().id;
    const t = await create(ownerA);

    const onUpdate = await patch(ownerA, t.id, { assigneeId: outsider });
    const onCreate = await ctx.app.inject({
      method: "POST",
      url: "/tickets",
      headers: ctx.auth(ownerA),
      payload: { title: "Sneaky", description: "x", assigneeId: outsider },
    });
    expect(onUpdate.statusCode).toBe(400);
    expect(onCreate.statusCode).toBe(400);
    const after = (await ctx.app.inject({ method: "GET", url: `/tickets/${t.id}`, headers: ctx.auth(ownerA) })).json();
    expect(after.assigneeId).toBeNull();
  });
});

describe("conversation and history", () => {
  it("keeps replies and internal notes with their author", async () => {
    const t = await create(ownerA);
    const reply = await comment(agentA.token, t.id, { body: "Restarted the VPN server, can you try again?" });
    const note = await comment(ownerA, t.id, { body: "Second outage this week, check the provider", internal: true });
    expect(reply.statusCode).toBe(201);
    expect(reply.json()).toMatchObject({ internal: false, authorName: "Ana Agent" });
    expect(note.json()).toMatchObject({ internal: true, authorName: "Owner Acme" });
  });

  it("rejects an empty comment", async () => {
    const t = await create(ownerA);
    expect((await comment(ownerA, t.id, { body: "   " })).statusCode).toBe(400);
  });

  it("records who changed what, in order, alongside the comments", async () => {
    const t = await create(ownerA);
    ctx.clock.advance(1);
    await patch(ownerA, t.id, { assigneeId: agentA.id });
    ctx.clock.advance(1);
    await comment(agentA.token, t.id, { body: "On it" });
    ctx.clock.advance(1);
    await patch(agentA.token, t.id, { status: "resolved", priority: "high" });

    const items = (await timeline(ownerA, t.id)).json();
    expect(
      items.map((i: { kind: string; type?: string; authorName: string }) => [i.kind, i.type ?? "", i.authorName]),
    ).toEqual([
      ["event", "created", "Owner Acme"],
      ["event", "assignee", "Owner Acme"],
      ["comment", "", "Ana Agent"],
      ["event", "status", "Ana Agent"],
      ["event", "priority", "Ana Agent"],
    ]);
    expect(items[3]).toMatchObject({ fromValue: "open", toValue: "resolved" });
    expect(items[1]).toMatchObject({ fromValue: null, toValue: agentA.id });
  });

  it("does not record a change when nothing changed", async () => {
    const t = await create(ownerA);
    await patch(ownerA, t.id, { status: "open" });
    expect((await timeline(ownerA, t.id)).json()).toHaveLength(1);
  });

  it("hides another organization's conversation", async () => {
    const t = await create(ownerB);
    await comment(ownerB, t.id, { body: "Internal pricing details", internal: true });
    expect((await timeline(ownerA, t.id)).statusCode).toBe(404);
    expect((await comment(ownerA, t.id, { body: "hello" })).statusCode).toBe(404);
  });
});

describe("dashboard workload", () => {
  it("counts open and overdue tickets per assignee, including unassigned", async () => {
    await create(ownerA, { assigneeId: agentA.id, priority: "urgent" });
    await create(ownerA, { assigneeId: agentA.id, priority: "low" });
    await create(ownerA);
    const done = await create(ownerA, { assigneeId: agentA.id });
    await patch(ownerA, done.id, { status: "resolved" });
    ctx.clock.advance(5); // only the urgent one (4h) is overdue

    const res = (await ctx.app.inject({ method: "GET", url: "/dashboard", headers: ctx.auth(ownerA) })).json();
    expect(res.openByAssignee).toEqual([
      { assigneeId: agentA.id, name: "Ana Agent", open: 2, overdue: 1 },
      { assigneeId: null, name: null, open: 1, overdue: 0 },
    ]);
  });
});
