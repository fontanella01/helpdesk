import { buildApp } from "../src/app.js";
import { createDb } from "../src/db/client.js";

export const TEST_SECRET = "test-secret-with-at-least-32-characters!!";

// A fresh in-memory PostgreSQL and app for each test.
export async function setup() {
  const { db, close } = await createDb();
  const app = await buildApp(db, { jwtSecret: TEST_SECRET });

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

  return { app, db, register, auth, teardown };
}
