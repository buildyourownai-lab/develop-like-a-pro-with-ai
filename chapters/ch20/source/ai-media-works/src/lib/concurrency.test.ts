import { describe, expect, it } from "vitest";
import { mapWithConcurrencyLimit } from "./concurrency";

describe("mapWithConcurrencyLimit", () => {
  it("preserves input order in the output regardless of completion order", async () => {
    const items = [30, 10, 20, 5, 25];
    const result = await mapWithConcurrencyLimit(items, 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(result).toEqual(items);
  });

  it("never runs more than `limit` calls concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapWithConcurrencyLimit(items, 3, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return item;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("handles an empty array without invoking fn", async () => {
    let calls = 0;
    const result = await mapWithConcurrencyLimit([], 5, async () => {
      calls += 1;
      return 1;
    });
    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });

  it("works when limit is larger than the item count", async () => {
    const result = await mapWithConcurrencyLimit([1, 2, 3], 50, async (n) => n * 2);
    expect(result).toEqual([2, 4, 6]);
  });
});
