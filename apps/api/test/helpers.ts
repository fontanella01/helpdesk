import { buildApp } from "../src/app.js";
import { createDb } from "../src/db/client.js";
import { demoSuggester, type Suggester } from "../src/ai/suggest.js";

export const TEST_SECRET = "test-secret-with-at-least-32-characters!!";

// A fresh in-memory PostgreSQL and app for each test.
// The clock starts at a fixed moment and only moves when a test calls advance().
export async function setup(opts: { suggester?: Suggester } = {}) {
  const { db, close } = await createDb();
  let current = new Date("2026-01-05T09:00:00Z");
  const clock = {
    now: () => new Date(current),
    advance: (hours: number) => {
      current = new Date(current.getTime() + hours * 3_600_000);
    },
  };
  // tests never call a real AI provider: demo mode unless a test passes a fake
  const app = await buildApp(db, { jwtSecret: TEST_SECRET, now: clock.now, suggester: opts.suggester ?? demoSuggester });

  // Registers a new organization and returns its owner's token.
  const register = async (org: string, email: string, password = "s3cret-pass") => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { organizationName: org, name: "Owner " + org, email, password },
    });
    return res.json() as { token: string; user: { id: string; organizationId: string; role: string } };
  };

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const teardown = async () => {
    await app.close();
    await close();
  };

  return { app, db, register, auth, teardown, clock };
}
