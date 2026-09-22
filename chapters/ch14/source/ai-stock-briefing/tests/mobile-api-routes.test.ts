import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  market: vi.fn(),
  search: vi.fn(),
  stock: vi.fn(),
  filings: vi.fn(),
}));

vi.mock("@/lib/mobile-api", () => ({
  mobileMarketResponse: mocks.market,
  mobileSearchResponse: mocks.search,
  mobileStockResponse: mocks.stock,
  mobileFilingsResponse: mocks.filings,
  mobileErrorResponse: (caught: unknown) =>
    Response.json({ error: caught instanceof Error ? caught.message : "실패" }, { status: 502 }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});
describe("모바일 앱 전용 API 경로", () => {
  it("시장·검색·상세·공시 요청을 모바일 응답 계층으로 전달한다", async () => {
    mocks.market.mockResolvedValue({ schemaVersion: "1.0", market: {} });
    mocks.search.mockResolvedValue({ schemaVersion: "1.0", hits: [] });
    mocks.stock.mockResolvedValue({ schemaVersion: "1.0", quote: { code: "000660" } });
    mocks.filings.mockResolvedValue({ schemaVersion: "1.0", filings: [] });

    const marketRoute = await import("../src/app/api/mobile/market/route");
    const searchRoute = await import("../src/app/api/mobile/stocks/search/route");
    const stockRoute = await import("../src/app/api/mobile/stocks/[code]/route");
    const filingsRoute = await import("../src/app/api/mobile/stocks/[code]/filings/route");

    expect((await (await marketRoute.GET()).json()).schemaVersion).toBe("1.0");

    const searchRequest = new NextRequest("http://localhost/api/mobile/stocks/search?q=SK");
    await searchRoute.GET(searchRequest);
    expect(mocks.search).toHaveBeenCalledWith("SK");

    await stockRoute.GET(new Request("http://localhost/api/mobile/stocks/000660"), {
      params: Promise.resolve({ code: "000660" }),
    });
    expect(mocks.stock).toHaveBeenCalledWith("000660");

    const filingsRequest = new NextRequest("http://localhost/api/mobile/stocks/000660/filings?page=2");
    await filingsRoute.GET(filingsRequest, { params: Promise.resolve({ code: "000660" }) });
    expect(mocks.filings).toHaveBeenCalledWith("000660", "2");
  });

  it("상류 실패를 사람이 읽는 오류 응답으로 바꾼다", async () => {
    mocks.market.mockRejectedValue(new Error("상류 실패"));
    const { GET } = await import("../src/app/api/mobile/market/route");
    const response = await GET();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "상류 실패" });
  });
});
