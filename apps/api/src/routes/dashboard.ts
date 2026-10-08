import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import type { Clock } from "./tickets.js";

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// Team numbers for the organization of the logged-in user.
// Aggregation happens in PostgreSQL (one query per block) instead of loading
// every ticket into Node — this stays fast as the table grows.
export function dashboardRoutes(app: FastifyInstance, db: Db, now: Clock) {
  app.addHook("preHandler", app.authenticate);

  app.get("/dashboard", async (req) => {
    const org = req.user.org;
    const t = now().toISOString();

    const summary = (
      await db.execute(sql`
        SELECT
          count(*) FILTER (WHERE resolved_at IS NULL)                         AS open_total,
          count(*) FILTER (WHERE resolved_at IS NULL AND due_at < ${t})       AS overdue,
          count(*) FILTER (WHERE resolved_at IS NULL AND due_at >= ${t}
                             AND due_at < ${t}::timestamptz + interval '4 hours') AS due_soon,
          count(*) FILTER (WHERE resolved_at >= ${t}::timestamptz - interval '30 days') AS resolved_30d,
          avg(extract(epoch FROM resolved_at - created_at) / 3600)
            FILTER (WHERE resolved_at >= ${t}::timestamptz - interval '30 days') AS avg_resolution_hours,
          count(*) FILTER (WHERE resolved_at >= ${t}::timestamptz - interval '30 days'
                             AND resolved_at <= due_at)                        AS resolved_on_time_30d
        FROM tickets
        WHERE organization_id = ${org}
      `)
    ).rows[0] as Row;

    const byStatus = (
      await db.execute(sql`SELECT status, count(*) AS n FROM tickets WHERE organization_id = ${org} GROUP BY status`)
    ).rows as Row[];

    const openByPriority = (
      await db.execute(sql`
        SELECT priority, count(*) AS n FROM tickets
        WHERE organization_id = ${org} AND resolved_at IS NULL GROUP BY priority
      `)
    ).rows as Row[];

    const resolved30 = num(summary.resolved_30d) ?? 0;
    const avg = num(summary.avg_resolution_hours);
    return {
      openTotal: num(summary.open_total) ?? 0,
      overdue: num(summary.overdue) ?? 0,
      dueSoon: num(summary.due_soon) ?? 0,
      resolved30d: resolved30,
      avgResolutionHours: avg === null ? null : Math.round(avg * 10) / 10,
      onTimeRate30d: resolved30 ? Math.round(((num(summary.resolved_on_time_30d) ?? 0) / resolved30) * 100) : null,
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
      openByPriority: Object.fromEntries(openByPriority.map((r) => [r.priority, Number(r.n)])),
    };
  });
}
