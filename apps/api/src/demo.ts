import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { tickets, users } from "./db/schema.js";

export const DEMO_EMAIL = "marina@northwind.demo";

type Seed = {
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  assignee?: "ana" | "bruno";
  status?: "in_progress" | "waiting_customer" | "resolved";
  category?: "billing" | "technical" | "account" | "feature_request" | "other";
  // how long ago it was opened, and (if resolved) how long it took
  hoursAgo: number;
  resolvedAfter?: number;
  comments?: { by: "ana" | "bruno" | "owner"; body: string; internal?: boolean }[];
};

const SEED: Seed[] = [
  {
    title: "Internet down at the Joinville office",
    description: "Since 8am nobody on the 2nd floor can connect. The router shows a red light.",
    priority: "urgent",
    assignee: "ana",
    status: "in_progress",
    category: "technical",
    hoursAgo: 2,
    comments: [
      { by: "ana", body: "Hi! We are checking the line now. Could you tell me if the router's PON light is red or blinking?" },
      { by: "ana", body: "Fiber cut reported by the provider on Rua XV. Field team ETA 11am.", internal: true },
    ],
  },
  {
    title: "Charged twice on the October invoice",
    description: "Our card shows two charges of R$ 389,90 for the same invoice. Please refund one of them.",
    priority: "high",
    assignee: "bruno",
    status: "waiting_customer",
    category: "billing",
    hoursAgo: 5,
    comments: [{ by: "bruno", body: "Sorry about that. I found both charges and opened the refund. Can you confirm the last 4 digits of the card?" }],
  },
  {
    title: "Cannot reset my password",
    description: "The reset e-mail never arrives. I checked the spam folder.",
    priority: "high",
    hoursAgo: 11,
  },
  { title: "Slow speed in the evening", description: "Between 7pm and 10pm the connection drops to 5 Mbps.", priority: "medium", assignee: "bruno", hoursAgo: 20 },
  { title: "Export call history to CSV", description: "It would help a lot to export the monthly call history as a spreadsheet.", priority: "low", hoursAgo: 30 },
  {
    title: "Add two new users to our account",
    description: "We hired two people and need logins for them by Monday.",
    priority: "medium",
    assignee: "ana",
    status: "resolved",
    category: "account",
    hoursAgo: 52,
    resolvedAfter: 6,
    comments: [{ by: "ana", body: "Done! Both users got an invitation e-mail." }],
  },
  {
    title: "VPN disconnects every hour",
    description: "The VPN drops roughly every 60 minutes and we have to log in again.",
    priority: "high",
    assignee: "bruno",
    status: "resolved",
    category: "technical",
    hoursAgo: 75,
    resolvedAfter: 5,
  },
  {
    title: "Wrong company name on the invoice",
    description: "The invoice says 'Northwind Telecom Ltda' but we are 'Northwind Telecom S.A.'.",
    priority: "low",
    assignee: "ana",
    status: "resolved",
    category: "billing",
    hoursAgo: 120,
    resolvedAfter: 30,
  },
];

// Empties every table (the schema stays). Only for the public demo: on a permanent
// database it makes each boot start from a clean sample company. Never on real data.
export async function resetData(db: Db) {
  await db.execute(sql`TRUNCATE ticket_events, ticket_comments, tickets, users, organizations CASCADE`);
}

// Creates the sample company used by the "Try the demo" button. Goes through the
// real routes (so the data follows every rule), then moves dates into the past so
// the SLA clock and the dashboard have something to show.
export async function seedDemo(app: FastifyInstance, db: Db) {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_EMAIL));
  if (existing) return false;

  const call = async (method: "GET" | "POST" | "PATCH", url: string, token?: string, payload?: object) => {
    const res = await app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (res.statusCode >= 400) throw new Error(`Demo seed failed on ${method} ${url}: ${res.body}`);
    return res.json();
  };
  const password = () => randomBytes(18).toString("hex");

  const ownerPass = password();
  const owner = await call("POST", "/auth/register", undefined, { organizationName: "Northwind Telecom", name: "Marina Costa", email: DEMO_EMAIL, password: ownerPass });
  const team: Record<string, { id: string; token: string }> = { owner: { id: owner.user.id, token: owner.token } };
  for (const [key, name] of [
    ["ana", "Ana Lima"],
    ["bruno", "Bruno Souza"],
  ] as const) {
    const pass = password();
    const email = `${key}@northwind.demo`;
    const user = await call("POST", "/users", owner.token, { name, email, password: pass });
    team[key] = { id: user.id, token: (await call("POST", "/auth/login", undefined, { email, password: pass })).token };
  }

  for (const s of SEED) {
    const t = await call("POST", "/tickets", owner.token, {
      title: s.title,
      description: s.description,
      priority: s.priority,
      assigneeId: s.assignee ? team[s.assignee].id : null,
    });
    const actor = team[s.assignee ?? "owner"].token;
    if (s.category) await call("PATCH", `/tickets/${t.id}`, actor, { category: s.category });
    for (const c of s.comments ?? []) await call("POST", `/tickets/${t.id}/comments`, team[c.by].token, { body: c.body, internal: c.internal ?? false });
    if (s.status) await call("PATCH", `/tickets/${t.id}`, actor, { status: s.status });

    // shift the whole ticket (and its history) back in time
    const back = sql`${s.hoursAgo} * interval '1 hour'`;
    await db.execute(sql`
      UPDATE tickets SET
        created_at = created_at - ${back},
        updated_at = updated_at - ${back},
        due_at = due_at - ${back},
        resolved_at = CASE WHEN resolved_at IS NULL THEN NULL ELSE created_at - ${back} + ${s.resolvedAfter ?? 1} * interval '1 hour' END
      WHERE id = ${t.id}
    `);
    await db.execute(sql`UPDATE ticket_comments SET created_at = created_at - ${back} + interval '20 minutes' WHERE ticket_id = ${t.id}`);
    await db.execute(sql`UPDATE ticket_events SET created_at = created_at - ${back} WHERE ticket_id = ${t.id}`);
  }
  return (await db.select({ id: tickets.id }).from(tickets)).length > 0;
}
