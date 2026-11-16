import { expect, it, vi } from "vitest";
import { fetchDart } from "../../src/lib/dart-fetch";
it("sets bounded manual-redirect requests", async () => {
  const mock = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", mock);
  await fetchDart("https://opendart.fss.or.kr/api/list.json?crtfc_key=fixture");
  expect(mock.mock.calls[0][1]).toMatchObject({ redirect: "manual", headers: { "User-Agent": "BookStockBriefing/1.0" } });
  expect(mock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
it("rejects redirects without exposing URL or credentials", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://untrusted.invalid" } })));
  await expect(fetchDart("https://opendart.fss.or.kr/?crtfc_key=fixture-secret")).rejects.toThrow(/^OpenDART HTTP 302$/);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fixture-secret")));
  await expect(fetchDart("https://opendart.fss.or.kr")).rejects.toThrow(/^OpenDART 요청에 실패했습니다.$/);
});
