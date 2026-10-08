import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, PRIORITY_LABEL, STATUS_LABEL, type Ticket, type TicketPriority, type TicketStatus } from "../lib/api";
import { DueLabel, ErrorText, Field, PriorityLabel, Select, StatusBadge } from "../components/ui";

export function TicketDetailPage() {
  const { id = "" } = useParams();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getTicket(id).then(setTicket).catch((e) => setError(e.message));
  }, [id]);

  const update = async (patch: { status?: TicketStatus; priority?: TicketPriority }) => {
    setSaving(true);
    setError("");
    try {
      setTicket(await api.updateTicket(id, patch));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error && !ticket) {
    return (
      <div className="space-y-4">
        <ErrorText>{error}</ErrorText>
        <Link to="/tickets" className="text-sm font-semibold text-brand-600 hover:underline">
          ← Back to tickets
        </Link>
      </div>
    );
  }
  if (!ticket) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <Link to="/tickets" className="text-sm font-semibold text-brand-600 hover:underline">
        ← Back to tickets
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <article className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={ticket.status} />
            <PriorityLabel priority={ticket.priority} />
            <DueLabel ticket={ticket} />
          </div>
          <h1 className="text-2xl font-bold">{ticket.title}</h1>
          <p className="whitespace-pre-wrap text-slate-700">{ticket.description}</p>
          <p className="text-xs text-slate-400">
            Opened {new Date(ticket.createdAt).toLocaleString("en-US")} · Updated {new Date(ticket.updatedAt).toLocaleString("en-US")}
          </p>
        </article>

        <aside className="h-fit space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <Field label="Status">
            <Select id="status" disabled={saving} value={ticket.status} onChange={(e) => update({ status: e.target.value as TicketStatus })}>
              {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Select id="detail-priority" disabled={saving} value={ticket.priority} onChange={(e) => update({ priority: e.target.value as TicketPriority })}>
              {(Object.keys(PRIORITY_LABEL) as TicketPriority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-xs text-slate-500">
            Deadline: {new Date(ticket.dueAt).toLocaleString("en-US")}
            <br />
            Set by priority: urgent 4h, high 8h, medium 24h, low 72h.
          </p>
          <ErrorText>{error}</ErrorText>
        </aside>
      </div>
    </div>
  );
}
