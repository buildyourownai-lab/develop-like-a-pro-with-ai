import { AsyncLocalStorage } from "node:async_hooks";

// One request owns its budget; concurrent requests never share counters.
const budgets = new AsyncLocalStorage<{ deadline: number; calls: Record<string, number> }>();
export function withExecutionBudget<T>(work: () => Promise<T>): Promise<T> {
  return budgets.run({ deadline: Date.now() + 150_000, calls: {} }, work);
}
export function requestSignal(kind: "youtube_read" | "youtube_write" | "oauth" | "gemini" | "store" | "cleanup"): AbortSignal {
  const budget = budgets.getStore();
  let remaining = 30_000;
  if (budget) {
    const limits = { youtube_read: 100, youtube_write: Infinity, oauth: 4, gemini: 60, store: Infinity, cleanup: Infinity };
    budget.calls[kind] = (budget.calls[kind] ?? 0) + 1;
    remaining = Math.min(remaining, budget.deadline + (kind === "cleanup" ? 30_000 : 0) - Date.now());
    if (budget.calls[kind] > limits[kind] || remaining <= 0) throw new Error("Execution budget exhausted");
  }
  return AbortSignal.timeout(remaining);
}
