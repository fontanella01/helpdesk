import { describe, expect, it } from "vitest";
import { dueAt, isOverdue, nextResolvedAt } from "../src/domain/sla.js";

const t0 = new Date("2026-01-05T09:00:00Z");
const plus = (h: number) => new Date(t0.getTime() + h * 3_600_000);

describe("SLA rules", () => {
  it("gives each priority its deadline", () => {
    expect(dueAt(t0, "urgent")).toEqual(plus(4));
    expect(dueAt(t0, "high")).toEqual(plus(8));
    expect(dueAt(t0, "medium")).toEqual(plus(24));
    expect(dueAt(t0, "low")).toEqual(plus(72));
  });

  it("is overdue only when not done and past the deadline", () => {
    expect(isOverdue({ status: "open", dueAt: plus(4) }, plus(3))).toBe(false);
    expect(isOverdue({ status: "open", dueAt: plus(4) }, plus(5))).toBe(true);
    expect(isOverdue({ status: "resolved", dueAt: plus(4) }, plus(5))).toBe(false);
  });

  it("sets resolved_at once, keeps it, and clears it when reopened", () => {
    expect(nextResolvedAt(null, "resolved", plus(2))).toEqual(plus(2));
    expect(nextResolvedAt(plus(2), "closed", plus(9))).toEqual(plus(2));
    expect(nextResolvedAt(plus(2), "open", plus(9))).toBeNull();
  });
});
