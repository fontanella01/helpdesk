import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, PRIORITY_LABEL, STATUS_LABEL, type Ticket, type TicketPriority, type TicketStatus } from "../lib/api";
import { Button, DueLabel, ErrorText, Field, Input, PriorityLabel, Select, StatusBadge, Textarea } from "../components/ui";

const STATUSES = Object.keys(STATUS_LABEL) as TicketStatus[];
const PRIORITIES = Object.keys(PRIORITY_LABEL) as TicketPriority[];
type Filter = TicketStatus | "overdue" | "";

export function TicketsPage() {
  // the filter lives in the URL (?filter=overdue), so the dashboard can link straight to it
  const [params, setParams] = useSearchParams();
  const filter = (params.get("filter") ?? "") as Filter;
  const setFilter = (f: Filter) => setParams(f ? { filter: f } : {}, { replace: true });
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = () =>
    api
      .listTickets(filter === "overdue" ? { overdue: true, sort: "due" } : { status: filter || undefined })
      .then(setTickets)
      .catch((e) => setError(e.message));

  useEffect(() => {
    setTickets(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Tickets</h1>
          <p className="text-sm text-slate-500">{filter === "overdue" ? "Past their deadline, most late first." : "Requests from your customers, newest first."}</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Select id="status-filter" aria-label="Filter tickets" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="min-w-0 flex-1 sm:w-48 sm:flex-none">
            <option value="">All tickets</option>
            <option value="overdue">Overdue</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "New ticket"}</Button>
        </div>
      </div>

      {showForm && (
        <NewTicketForm
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <ErrorText>{error}</ErrorText>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {tickets === null ? (
          <p className="p-6 text-sm text-slate-500">Loading…</p>
        ) : tickets.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-semibold">No tickets here yet</p>
            <p className="text-sm text-slate-500">{filter === "overdue" ? "Nothing is late. Nice work." : filter ? "Try another filter." : "Create the first one with “New ticket”."}</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link to={`/tickets/${t.id}`} className="flex flex-col gap-2 px-5 py-4 hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{t.title}</p>
                    <p className="truncate text-sm text-slate-500">{t.description}</p>
                  </div>
                  {/* on phones the badges drop below the title instead of squeezing it */}
                  <div className="flex items-center gap-3 sm:gap-4">
                    <PriorityLabel priority={t.priority} />
                    <StatusBadge status={t.status} />
                    <span className="ml-auto tabular-nums sm:w-28 sm:text-right">
                      <DueLabel ticket={t} />
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NewTicketForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ title: "", description: "", priority: "medium" as TicketPriority });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.createTicket(form);
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <Field label="Title">
          <Input id="title" required minLength={3} maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Short summary of the problem" />
        </Field>
        <Field label="Priority">
          <Select id="priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TicketPriority })}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Description">
        <Textarea id="description" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What happened? Steps, error messages, who is affected…" />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create ticket"}
        </Button>
      </div>
    </form>
  );
}
