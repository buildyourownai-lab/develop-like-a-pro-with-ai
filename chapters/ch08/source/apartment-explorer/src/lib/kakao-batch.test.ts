import { describe, expect, it, vi } from "vitest";
import { createKakaoBatchFetch } from "./kakao-batch";
import { fetchKakao, withKakaoTransport } from "./kakao-transport";
import worker from "../../cloudflare/kakao-worker.mjs";

describe("Cloudflare Kakao transport", () => {
  it("batches concurrent requests and preserves response order/status", async () => {
    const binding = { fetch: vi.fn(async (request: Request) => {
      const urls = await request.json();
      expect(request.headers.get("Authorization")).toBe("KakaoAK test-only");
      return Response.json(urls.map((url: string, i: number) => ({ status: i ? 429 : 200, body: url })));
    }) };
    const run = createKakaoBatchFetch(binding);
    const responses = await Promise.all(["address", "category"].map(name => run(name, { headers: { Authorization: "KakaoAK test-only" } })));
    expect(binding.fetch).toHaveBeenCalledTimes(1);
    expect(responses.map(r => r.status)).toEqual([200, 429]);
    expect(await responses[0].text()).toBe("address");
  });
  it("keeps independent queues and rejects malformed binding results", async () => {
    const one = { fetch: vi.fn(async () => Response.json([])) };
    const two = { fetch: vi.fn(async () => Response.json([{ status: 200, body: "two" }])) };
    const init = { headers: { Authorization: "KakaoAK test-only" } };
    const [a, b] = await Promise.allSettled([createKakaoBatchFetch(one)("one", init), createKakaoBatchFetch(two)("two", init)]);
    expect(a.status).toBe("rejected");
    expect(b.status).toBe("fulfilled");
    if (b.status === "fulfilled") expect(await b.value.text()).toBe("two");
  });
  it("rejects an active aborted caller before binding completion, preserving its peer", async () => {
    let finish!: (response: Response) => void;
    const binding = { fetch: vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })) };
    const run = createKakaoBatchFetch(binding);
    const controller = new AbortController();
    const init = { headers: { Authorization: "KakaoAK test-only" } };
    const aborted = run("one", { ...init, signal: controller.signal });
    const peer = run("two", init);
    await vi.waitFor(() => expect(binding.fetch).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(aborted).rejects.toThrow("timed out");
    finish(Response.json([{ status: 200, body: "one" }, { status: 200, body: "two" }]));
    expect(await (await peer).text()).toBe("two");
  });
  it("does not send a queued caller that aborts before flush", async () => {
    const binding = { fetch: vi.fn(async () => Response.json([])) };
    const controller = new AbortController();
    const result = createKakaoBatchFetch(binding)("one", {
      headers: { Authorization: "KakaoAK test-only" }, signal: controller.signal,
    });
    controller.abort();
    await expect(result).rejects.toThrow("timed out");
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(binding.fetch).not.toHaveBeenCalled();
  });
  it("retains direct fetch in Node", async () => {
    vi.stubEnv("CLOUDFLARE_KAKAO_BATCH", "0");
    const fake = vi.fn(async () => new Response("node"));
    vi.stubGlobal("fetch", fake);
    try { expect(await (await withKakaoTransport(() => fetchKakao("https://example.test", {}))).text()).toBe("node"); }
    finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
  it("rejects non-Kakao URLs and unauthenticated private calls before egress", async () => {
    expect((await worker.fetch(new Request("https://kakao.internal/batch", { method: "POST" }))).status).toBe(401);
    const res = await worker.fetch(new Request("https://kakao.internal/batch", { method: "POST", headers: { Authorization: "KakaoAK test-only" }, body: JSON.stringify(["https://example.test/"]) }));
    expect(res.status).toBe(400);
  });
  it("allows all four teaching-stage endpoints", async () => {
    const fake = vi.fn(async () => Response.json({ documents: [] })); vi.stubGlobal("fetch", fake);
    try {
      const paths = ["search/address.json", "search/category.json", "search/keyword.json", "geo/coord2regioncode.json"];
      const res = await worker.fetch(new Request("https://kakao.internal/batch", { method: "POST", headers: { Authorization: "KakaoAK test-only" }, body: JSON.stringify(paths.map(p => `https://dapi.kakao.com/v2/local/${p}`)) }));
      expect(res.status).toBe(200); expect(fake).toHaveBeenCalledTimes(4);
    } finally { vi.unstubAllGlobals(); }
  });
});
