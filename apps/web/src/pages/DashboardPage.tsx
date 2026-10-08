import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, PRIORITY_LABEL, STATUS_LABEL, type Dashboard, type TicketPriority, type TicketStatus } from "../lib/api";
import { ErrorText } from "../components/ui";

function Metric({ label, value, hint, tone = "default", to }: { label: string; value: string; hint: string; tone?: "default" | "danger" | "warn"; to?: string }) {
  const color = tone === "danger" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-ink";
  const body = (
    <>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${color}`}>{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </>
  );
  const cls = "block rounded-xl border border-slate-200 bg-white p-5";
  return to ? (
    <Link to={to} className={`${cls} transition-colors hover:border-brand-500`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// Horizontal bars sharing one scale, so lengths are comparable across rows.
function Bars<K extends string>({ title, data, labels, order }: { title: string; data: Partial<Record<K, number>>; labels: Record<K, string>; order: K[] }) {
  const max = Math.max(1, ...order.map((k) => data[k] ?? 0));
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-semibold text-slate-700">{title}</h2>
      <ul className="space-y-3">
        {order.map((k) => {
          const n = data[k] ?? 0;
          return (
            <li key={k} className="grid grid-cols-[9rem_1fr_2rem] items-center gap-3 text-sm">
              <span className="text-slate-600">{labels[k]}</span>
              <span className="h-2 rounded-full bg-slate-100">
                <span className="block h-2 rounded-full bg-brand-500" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums font-semibold">{n}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function DashboardPage() {
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.dashboard().then(setD).catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-slate-500">How the team is doing against its deadlines.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Metric label="Open tickets" value={String(d.openTotal)} hint="Not resolved yet" to="/tickets" />
        <Metric label="Overdue" value={String(d.overdue)} hint="Past their deadline" tone={d.overdue ? "danger" : "default"} to="/tickets?filter=overdue" />
        <Metric label="Due in the next 4h" value={String(d.dueSoon)} hint="Act on these first" tone={d.dueSoon ? "warn" : "default"} />
        <Metric
          label="Resolved on time"
          value={d.onTimeRate30d === null ? "—" : `${d.onTimeRate30d}%`}
          hint={d.avgResolutionHours === null ? "No tickets resolved in 30 days" : `${d.resolved30d} resolved in 30 days · avg ${d.avgResolutionHours}h`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Bars title="All tickets by status" data={d.byStatus} labels={STATUS_LABEL} order={Object.keys(STATUS_LABEL) as TicketStatus[]} />
        <Bars title="Open tickets by priority" data={d.openByPriority} labels={PRIORITY_LABEL} order={["urgent", "high", "medium", "low"] as TicketPriority[]} />
      </div>
    </div>
  );
}
