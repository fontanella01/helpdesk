import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDb } from "../src/db/client.js";
import { LIMITS } from "../src/security.js";
import { withDailyLimit } from "../src/ai/budget.js";
import { demoSuggester, type Suggester } from "../src/ai/suggest.js";
import { setup, TEST_SECRET } from "./helpers.js";

let ctx: Awaited<ReturnType<typeof setup>>;
afterEach(async () => {
  await ctx?.teardown();
  ctx = undefined!;
});

describe("hardening", () => {
  it("sends security headers on every response", async () => {
    ctx = await setup();
    const res = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["strict-transport-security"]).toBeDefined();
  });

  it("stops password guessing after a few attempts", async () => {
    ctx = await setup();
    await ctx.register("Acme", "owner@acme.test");
    const attempt = () => ctx.app.inject({ method: "POST", url: "/auth/login", payload: { email: "owner@acme.test", password: "guess-1234" } });
    const codes: number[] = [];
    for (let i = 0; i <= LIMITS.login.max; i++) codes.push((await attempt()).statusCode);
    expect(codes.slice(0, -1).every((c) => c === 401)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });

  it("counts limits per visitor behind the proxy, and a faked X-Forwarded-For does not reset them", async () => {
    const { db, close } = await createDb();
    const app = await buildApp(db, { jwtSecret: TEST_SECRET, suggester: demoSuggester, trustProxy: 1 });
    // the proxy appends the real address at the end; anything before it came from the visitor
    const login = (forwarded: string) =>
      app.inject({ method: "POST", url: "/auth/login", headers: { "x-forwarded-for": forwarded }, payload: { email: "x@acme.test", password: "guess-1234" } });
    for (let i = 0; i < LIMITS.login.max; i++) await login(`10.0.0.${i}, 203.0.113.7`);
    expect((await login("1.2.3.4, 203.0.113.7")).statusCode).toBe(429);
    expect((await login("203.0.113.8")).statusCode).toBe(401);
    await app.close();
    await close();
  });

  it("answers unexpected errors with a generic message", async () => {
    const { db, close } = await createDb();
    const app = await buildApp(db, { jwtSecret: TEST_SECRET, suggester: demoSuggester });
    app.get("/boom", async () => {
      throw new Error('relation "secret_table" does not exist');
    });
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect([res.statusCode, res.json()]).toEqual([500, { error: "Internal server error" }]);
    await app.close();
    await close();
  });
});

describe("daily AI budget", () => {
  const named = (reply: string): Suggester => ({ mode: "ai", suggest: async () => ({ category: "other", priority: "low", reply, source: "ai" }) });
  const ticket = { title: "Help", description: "Something broke" };

  it("switches to the fallback past the daily cap and starts over the next day", async () => {
    let now = new Date("2026-01-05T10:00:00Z");
    const suggester = withDailyLimit(named("claude"), named("rules"), 2, () => now);
    const replies = [];
    for (let i = 0; i < 3; i++) replies.push((await suggester.suggest(ticket)).reply);
    expect(replies).toEqual(["claude", "claude", "rules"]);

    now = new Date("2026-01-06T00:01:00Z");
    expect((await suggester.suggest(ticket)).reply).toBe("claude");
  });
});
