import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchFscPage } from "@/lib/fsc-api";

const originalKey = process.env.DATA_GO_KR_SERVICE_KEY;

beforeEach(() => {
  process.env.DATA_GO_KR_SERVICE_KEY = "unit-test-service-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.DATA_GO_KR_SERVICE_KEY;
  else process.env.DATA_GO_KR_SERVICE_KEY = originalKey;
});

describe("금융위원회 공통 요청", () => {
  it("정상 코드 000과 한 건짜리 응답을 처리한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      response: { header: { resultCode: "000", resultMsg: "OK" }, body: { totalCount: 1, items: { item: { code: "A" } } } },
    }), { status: 200 })));

    await expect(fetchFscPage<{ code: string }>("https://example.test", {}, "시세정보"))
      .resolves.toEqual({ totalCount: 1, items: [{ code: "A" }] });
  });

  it("인코딩되지 않은 인증키만 한 번 인코딩한다", async () => {
    process.env.DATA_GO_KR_SERVICE_KEY = "a+b/c=";
    const mocked = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      response: { header: { resultCode: "00" }, body: { totalCount: 0, items: "" } },
    }), { status: 200 }));
    vi.stubGlobal("fetch", mocked);

    await fetchFscPage("https://example.test", {}, "시세정보");
    expect(String(mocked.mock.calls[0][0])).toContain("serviceKey=a%2Bb%2Fc%3D");
  });

  it("이미 인코딩된 인증키를 다시 인코딩하지 않는다", async () => {
    process.env.DATA_GO_KR_SERVICE_KEY = "a%2Fb%3D";
    const mocked = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      response: { header: { resultCode: "00" }, body: { totalCount: 0, items: "" } },
    }), { status: 200 }));
    vi.stubGlobal("fetch", mocked);

    await expect(fetchFscPage("https://example.test", {}, "시세정보"))
      .resolves.toEqual({ totalCount: 0, items: [] });
    expect(String(mocked.mock.calls[0][0])).toContain("serviceKey=a%2Fb%3D");
    expect(String(mocked.mock.calls[0][0])).not.toContain("%252F");
  });

  it("정상 코드 00과 배열 응답을 처리한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      response: {
        header: { resultCode: "00", resultMsg: "OK" },
        body: { totalCount: 2, items: { item: [{ code: "A" }, { code: "B" }] } },
      },
    }), { status: 200 })));

    await expect(fetchFscPage<{ code: string }>("https://example.test", {}, "시세정보"))
      .resolves.toEqual({ totalCount: 2, items: [{ code: "A" }, { code: "B" }] });
  });

  it("HTTP 오류와 XML 인증 오류를 구체적으로 알린다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status: 503 })));
    await expect(fetchFscPage("https://example.test", {}, "시세정보"))
      .rejects.toThrow("시세정보 요청이 실패했습니다. (HTTP 503)");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(
      "<OpenAPI_ServiceResponse><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>KEY ERROR</returnAuthMsg></OpenAPI_ServiceResponse>",
      { status: 200 }
    )));
    await expect(fetchFscPage("https://example.test", {}, "시세정보"))
      .rejects.toThrow("SERVICE ERROR / KEY ERROR");
  });

  it("헤더가 없는 JSON과 연결 시간 초과를 undefined 없이 설명한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("{}", { status: 200 })));
    await expect(fetchFscPage("https://example.test", {}, "시세정보"))
      .rejects.toThrow("시세정보 응답이 정상이 아닙니다. (코드 없음: 응답 형식을 확인할 수 없습니다)");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")));
    await expect(fetchFscPage("https://example.test", {}, "시세정보"))
      .rejects.toThrow("시세정보 요청 시간이 초과되었습니다.");
  });

  it("일반 연결 실패를 URL이나 인증키 없이 설명한다", async () => {
    process.env.DATA_GO_KR_SERVICE_KEY = "secret-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed https://example.test?serviceKey=secret-key")));

    let message = "";
    try {
      await fetchFscPage("https://example.test", {}, "시세정보");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("시세정보 서버에 연결하지 못했습니다.");
    expect(message).not.toContain("secret-key");
    expect(message).not.toContain("https://");
  });

  it("일시적인 연결 실패와 500대 응답은 제한 횟수 안에서 다시 시도한다", async () => {
    const mocked = vi.fn()
      .mockRejectedValueOnce(new TypeError("temporary TLS failure"))
      .mockResolvedValueOnce(new Response("busy", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        response: { header: { resultCode: "00" }, body: { totalCount: 0, items: "" } },
      }), { status: 200 }));
    vi.stubGlobal("fetch", mocked);

    await expect(fetchFscPage("https://example.test", {}, "시세정보"))
      .resolves.toEqual({ totalCount: 0, items: [] });
    expect(mocked).toHaveBeenCalledTimes(3);
  });

  it("기본 fetch 요청을 병렬 처리하고 Next 캐시 옵션을 사용한다", async () => {
    let active = 0;
    let maxActive = 0;
    const mocked = vi.fn().mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return new Response(JSON.stringify({
        response: { header: { resultCode: "00" }, body: { totalCount: 0, items: "" } },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", mocked);

    await Promise.all([
      fetchFscPage("https://example.test/a", {}, "시세정보"),
      fetchFscPage("https://example.test/b", {}, "지수정보"),
    ]);
    expect(maxActive).toBe(2);
    expect(mocked.mock.calls[0][1]).toMatchObject({ next: { revalidate: 600 } });
  });
});
