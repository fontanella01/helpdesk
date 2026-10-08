import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { setup } from "./helpers.js";
import { users } from "../src/db/schema.js";

let ctx: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  ctx = await setup();
});

afterEach(() => ctx.teardown());

const login = (email: string, password: string) =>
  ctx.app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });

describe("auth", () => {
  it("registers an organization with its owner and returns a token", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { organizationName: "Acme", name: "Ana", email: "Ana@Acme.com", password: "s3cret-pass" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toBeTypeOf("string");
    expect(body.user).toMatchObject({ name: "Ana", email: "ana@acme.com", role: "owner" });
    expect(body.user).not.toHaveProperty("passwordHash");
  });

  it("never stores the plain password", async () => {
    await ctx.register("Acme", "ana@acme.com", "s3cret-pass");
    const [row] = await ctx.db.select().from(users).where(eq(users.email, "ana@acme.com"));
    expect(row.passwordHash).not.toContain("s3cret-pass");
    expect(row.passwordHash.startsWith("scrypt$")).toBe(true);
  });

  it("rejects a duplicate email", async () => {
    await ctx.register("Acme", "ana@acme.com");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { organizationName: "Other", name: "Ana", email: "ANA@acme.com", password: "s3cret-pass" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects weak passwords and invalid emails", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { organizationName: "Acme", name: "Ana", email: "not-an-email", password: "123" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("logs in with the right password, case-insensitive email", async () => {
    await ctx.register("Acme", "ana@acme.com", "s3cret-pass");
    const res = await login("ANA@acme.com", "s3cret-pass");
    expect(res.statusCode).toBe(200);
    const me = await ctx.app.inject({ method: "GET", url: "/auth/me", headers: ctx.auth(res.json().token) });
    expect(me.json().email).toBe("ana@acme.com");
  });

  it("gives the same answer for wrong password and unknown email", async () => {
    await ctx.register("Acme", "ana@acme.com", "s3cret-pass");
    const wrong = await login("ana@acme.com", "wrong-pass");
    const unknown = await login("nobody@acme.com", "s3cret-pass");
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it("lets only the owner add agents, in the owner's organization", async () => {
    const owner = await ctx.register("Acme", "ana@acme.com");
    const added = await ctx.app.inject({
      method: "POST",
      url: "/users",
      headers: ctx.auth(owner.token),
      payload: { name: "Bruno", email: "bruno@acme.com", password: "agent-pass" },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json()).toMatchObject({ role: "agent", organizationId: owner.user.organizationId });

    const agentToken = (await login("bruno@acme.com", "agent-pass")).json().token;
    const denied = await ctx.app.inject({
      method: "POST",
      url: "/users",
      headers: ctx.auth(agentToken),
      payload: { name: "Carla", email: "carla@acme.com", password: "agent-pass" },
    });
    expect(denied.statusCode).toBe(403);
  });
});
