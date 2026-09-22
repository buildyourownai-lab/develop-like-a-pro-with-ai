import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSignal, withExecutionBudget } from "./execution-budget";
afterEach(() => vi.restoreAllMocks());
describe("bounded external requests", () => {
  it("stops work at the deadline but permits bounded cleanup", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await withExecutionBudget(async () => {
      requestSignal("youtube_read");
      now += 150_000;
      expect(() => requestSignal("youtube_write")).toThrow();
      expect(() => requestSignal("cleanup")).not.toThrow();
      now += 30_000;
      expect(() => requestSignal("cleanup")).toThrow();
    });
  });
  it("allows multiple writes within the time budget", async () => {
    await Promise.all([1, 2].map(() => withExecutionBudget(async () => {
      requestSignal("youtube_write");
      expect(() => requestSignal("youtube_write")).not.toThrow();
    })));
  });
  it("caps actual read calls including reply pagination", async () => {
    await withExecutionBudget(async () => {
      for (let i = 0; i < 100; i++) requestSignal("youtube_read");
      expect(() => requestSignal("youtube_read")).toThrow();
    });
  });
});
