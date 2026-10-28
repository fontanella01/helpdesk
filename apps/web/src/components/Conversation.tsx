import { useState, type FormEvent } from "react";
import { CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL, type TicketCategory, type TicketPriority, type TicketStatus, type TimelineItem, type User } from "../lib/api";
import { Button, ErrorText, Textarea } from "./ui";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// One sentence per history entry: "Ana changed status from Open to Resolved".
function describe(item: Extract<TimelineItem, { kind: "event" }>, userName: (id: string | null) => string) {
  const label = (v: string | null) => {
    if (v === null) return "none";
    switch (item.type) {
      case "status":
        return STATUS_LABEL[v as TicketStatus] ?? v;
      case "priority":
        return PRIORITY_LABEL[v as TicketPriority] ?? v;
      case "category":
        return CATEGORY_LABEL[v as TicketCategory] ?? v;
      default:
        return v;
    }
  };
  switch (item.type) {
    case "created":
      return "opened the ticket";
    case "assignee":
      return item.toValue ? `assigned it to ${userName(item.toValue)}` : "removed the assignee";
    default:
      return `changed ${item.type} from ${label(item.fromValue)} to ${label(item.toValue)}`;
  }
}

export function Conversation({
  items,
  users,
  draft,
  onDraftChange,
  onSend,
}: {
  items: TimelineItem[];
  users: User[];
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: (body: string, internal: boolean) => Promise<void>;
}) {
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const userName = (id: string | null) => users.find((u) => u.id === id)?.name ?? "a former member";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onSend(draft, internal);
      onDraftChange("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold">Conversation</h2>

      <ol className="space-y-3">
        {items.map((item) =>
          item.kind === "event" ? (
            <li key={item.id} className="flex flex-wrap items-baseline gap-x-1.5 pl-1 text-xs text-slate-500">
              <span className="size-1.5 shrink-0 translate-y-[-1px] self-center rounded-full bg-slate-300" aria-hidden />
              <span className="font-medium text-slate-700">{item.authorName ?? "Someone"}</span>
              <span>{describe(item, userName)}</span>
              <time className="text-slate-400" dateTime={item.createdAt}>
                {when(item.createdAt)}
              </time>
            </li>
          ) : (
            <li
              key={item.id}
              className={cx("rounded-lg border px-4 py-3", item.internal ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50")}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-ink">{item.authorName ?? "Former member"}</span>
                {item.internal && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">Internal note</span>}
                <time className="text-slate-400" dateTime={item.createdAt}>
                  {when(item.createdAt)}
                </time>
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{item.body}</p>
            </li>
          ),
        )}
      </ol>

      <form onSubmit={submit} className="space-y-3 border-t border-slate-100 pt-4">
        <div role="radiogroup" aria-label="Message type" className="inline-flex rounded-lg bg-slate-100 p-1 text-sm">
          {[
            { value: false, label: "Reply to customer" },
            { value: true, label: "Internal note" },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              role="radio"
              aria-checked={internal === opt.value}
              onClick={() => setInternal(opt.value)}
              className={cx("rounded-md px-3 py-1.5 font-medium", internal === opt.value ? "bg-white text-ink shadow-sm" : "text-slate-500 hover:text-ink")}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <Textarea
          id="comment"
          aria-label={internal ? "Internal note" : "Reply"}
          value={draft}
          maxLength={10_000}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={internal ? "Only your team sees this." : "Write a reply to the customer…"}
          className={cx(internal && "border-amber-300 bg-amber-50/50")}
        />
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || !draft.trim()}>
            {busy ? "Saving…" : internal ? "Add note" : "Send reply"}
          </Button>
        </div>
      </form>
    </section>
  );
}
