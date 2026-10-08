import { useState } from "react";
import { api, CATEGORY_LABEL, PRIORITY_LABEL, type Suggestion, type Ticket } from "../lib/api";
import { Button, ErrorText, Textarea } from "./ui";

// The assistant suggests; the agent decides. Nothing is applied or sent without a click.
export function AiAssist({ ticket, onApplied }: { ticket: Ticket; onApplied: (t: Ticket) => void }) {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"suggest" | "apply" | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setBusy("suggest");
    setError("");
    try {
      const s = await api.suggest(ticket.id);
      setSuggestion(s);
      setDraft(s.reply);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!suggestion) return;
    setBusy("apply");
    setError("");
    try {
      onApplied(await api.updateTicket(ticket.id, { category: suggestion.category, priority: suggestion.priority }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the text is still in the box to copy by hand
    }
  };

  const alreadyApplied = suggestion && ticket.category === suggestion.category && ticket.priority === suggestion.priority;

  return (
    <section className="space-y-4 rounded-xl border border-brand-100 bg-brand-50/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Assistant</h2>
          <p className="text-sm text-slate-600">Suggests a category, a priority and a first reply. You review before using it.</p>
        </div>
        <Button onClick={run} disabled={busy !== null}>
          {busy === "suggest" ? "Thinking…" : suggestion ? "Suggest again" : "Suggest with AI"}
        </Button>
      </div>

      <ErrorText>{error}</ErrorText>

      {suggestion && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span>
              <span className="text-slate-500">Category:</span> <strong>{CATEGORY_LABEL[suggestion.category]}</strong>
            </span>
            <span>
              <span className="text-slate-500">Priority:</span> <strong>{PRIORITY_LABEL[suggestion.priority]}</strong>
              {suggestion.priority !== ticket.priority && <span className="text-slate-500"> (now {PRIORITY_LABEL[ticket.priority]})</span>}
            </span>
            {suggestion.source === "demo" && (
              <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200" title="No AI key configured: rule-based suggestion">
                Demo mode
              </span>
            )}
            <Button variant="ghost" onClick={apply} disabled={busy !== null || !!alreadyApplied} className="ml-auto">
              {alreadyApplied ? "Applied" : busy === "apply" ? "Applying…" : "Apply category and priority"}
            </Button>
          </div>
          <div className="space-y-2">
            <label htmlFor="ai-draft" className="text-sm font-medium text-slate-700">
              Draft reply (edit before sending)
            </label>
            <Textarea id="ai-draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="flex justify-end">
              <Button variant="ghost" onClick={copy}>
                {copied ? "Copied" : "Copy reply"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
