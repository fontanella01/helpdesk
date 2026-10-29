import type { Suggester } from "./suggest.js";

// Caps how many AI suggestions happen per day (UTC). Past the cap, suggestions come
// from the fallback (the free keyword rules), so a public demo with a real API key
// cannot run up the bill. The count lives in memory: right for one instance, and it
// starts over on restart, which only makes the cap more lenient, never stricter.
export function withDailyLimit(suggester: Suggester, fallback: Suggester, limit: number, now: () => Date): Suggester {
  let day = "";
  let used = 0;
  return {
    mode: suggester.mode,
    async suggest(ticket) {
      const today = now().toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        used = 0;
      }
      if (used >= limit) return fallback.suggest(ticket);
      used++;
      return suggester.suggest(ticket);
    },
  };
}
