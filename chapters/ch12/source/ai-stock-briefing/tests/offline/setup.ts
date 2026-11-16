import { vi, beforeEach, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
beforeEach(() => { vi.stubGlobal("fetch", () => { throw new Error("Live network forbidden in offline tests"); }); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
