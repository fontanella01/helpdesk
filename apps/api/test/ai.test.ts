import { afterEach, describe, expect, it } from "vitest";
import { setup } from "./helpers.js";
import { demoSuggester, createSuggester, type Suggester } from "../src/ai/suggest.js";

let ctx: Awaited<ReturnType<typeof setup>> | undefined;
afterEach(() => ctx?.teardown());

async function withTicket(suggester?: Suggester, ticket = { title: "Invoice shows wrong amount", description: "We were charged twice this month." }) {
  ctx = await setup({ suggester });
  const token = (await ctx.register("Acme", "owner@acme.com")).token;
  const created = (await ctx.app.inject({ method: "POST", url: "/tickets", headers: ctx.auth(token), payload: ticket })).json();
  return { token, id: created.id as string };
}

describe("demo suggester", () => {
  it("classifies with keyword rules", async () => {
    expect(await demoSuggester.suggest({ title: "Production is down", description: "All users get an error 500" })).toMatchObject({
      category: "technical",
      priority: "urgent",
      source: "demo",
    });
    expect((await demoSuggester.suggest({ title: "Please add dark mode", description: "Feature request" })).category).toBe("feature_request");
    // impact counts: many people affected is urgent even without the word "down"
    expect(
      (await demoSuggester.suggest({ title: "VPN disconnects every 10 minutes", description: "Remote team loses VPN connection. Affects 12 people." })).priority,
    ).toBe("urgent");
    expect((await demoSuggester.suggest({ title: "Reset email", description: "Users never get the reset email" })).priority).toBe("high");
  });

  it("is used when no API key is configured", () => {
    expect(createSuggester({}).mode).toBe("demo");
    expect(createSuggester({ ANTHROPIC_API_KEY: "sk-test" }).mode).toBe("ai");
  });
});

describe("POST /tickets/:id/suggest", () => {
  it("returns a suggestion for the ticket", async () => {
    const { token, id } = await withTicket();
    const res = await ctx!.app.inject({ method: "POST", url: `/tickets/${id}/suggest`, headers: ctx!.auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ category: "billing", source: "demo" });
    expect(res.json().reply.length).toBeGreaterThan(10);
  });

  it("sends the ticket text to the suggester and nothing from other tenants", async () => {
    const seen: string[] = [];
    const spy: Suggester = { mode: "ai", suggest: async (t) => (seen.push(t.title), { category: "other", priority: "low", reply: "ok", source: "ai" }) };
    const { token, id } = await withTicket(spy);
    await ctx!.app.inject({ method: "POST", url: `/tickets/${id}/suggest`, headers: ctx!.auth(token) });
    expect(seen).toEqual(["Invoice shows wrong amount"]);

    const other = (await ctx!.register("Globex", "owner@globex.com")).token;
    const denied = await ctx!.app.inject({ method: "POST", url: `/tickets/${id}/suggest`, headers: ctx!.auth(other) });
    expect(denied.statusCode).toBe(404);
    expect(seen).toHaveLength(1);
  });

  it("answers 503 with a friendly message when the provider fails", async () => {
    const broken: Suggester = { mode: "ai", suggest: async () => { throw new Error("connection reset"); } };
    const { token, id } = await withTicket(broken);
    const res = await ctx!.app.inject({ method: "POST", url: `/tickets/${id}/suggest`, headers: ctx!.auth(token) });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/unavailable/);
  });

  it("lets the agent apply the suggested category", async () => {
    const { token, id } = await withTicket();
    const res = await ctx!.app.inject({ method: "PATCH", url: `/tickets/${id}`, headers: ctx!.auth(token), payload: { category: "billing" } });
    expect(res.json().category).toBe("billing");
    const bad = await ctx!.app.inject({ method: "PATCH", url: `/tickets/${id}`, headers: ctx!.auth(token), payload: { category: "whatever" } });
    expect(bad.statusCode).toBe(400);
  });
});
