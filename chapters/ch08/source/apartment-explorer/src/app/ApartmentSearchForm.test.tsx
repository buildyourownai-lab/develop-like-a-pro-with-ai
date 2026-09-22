// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ApartmentSearchForm from "./ApartmentSearchForm";
import type { ApartmentComplexResult, ApartmentSearchOutcome } from "@/lib/apartmentSearch";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockFetchJson(outcome: ApartmentSearchOutcome) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => outcome,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function fillAndSubmit() {
  const user = userEvent.setup();
  const region = screen.getByLabelText(/^지역/);
  await user.clear(region);
  await user.type(region, "서울 강남구 대치동");
  await user.type(screen.getByLabelText(/^최소 전용면적/), "80");
  await user.type(screen.getByLabelText(/^최대 전용면적/), "90");
  await user.type(screen.getByLabelText(/^최소 가격/), "200000");
  await user.type(screen.getByLabelText(/^최대 가격/), "300000");
  await user.type(screen.getByLabelText(/^지하철역 거리/), "800");
  await user.type(screen.getByLabelText(/^초등학교 거리/), "1000");
  await user.click(screen.getByRole("button", { name: "아파트 찾기" }));
}

const SAMPLE_RESULT: ApartmentComplexResult = {
  aptName: "한티아파트",
  legalDong: "대치동",
  jibun: "12-3",
  buildYear: 2010,
  tradeCountInAreaRange: 5,
  priceRangeManwonInAreaRange: { min: 240000, max: 260000 },
  latestTrade: { dealAmountManwon: 255000, dealDate: "2026-06-10" },
  tradeCountInPriceRange: 3,
  matchingTrades: [
    {
      aptName: "한티아파트",
      legalDong: "대치동",
      jibun: "12-3",
      floor: 10,
      exclusiveAreaSqm: 84.5,
      buildYear: 2010,
      dealDate: "2026-06-10",
      dealAmountManwon: 255000,
      isCancelled: false,
      raw: {},
    },
  ],
  nearestSubway: { name: "한티역", distanceMeters: 450 },
  nearestElementarySchool: { name: "대치초등학교", distanceMeters: 300 },
  distanceNote: "지하철역·초등학교 거리는 아파트 대표 위치에서 각 장소까지의 직선거리입니다 (Kakao Local API 기준).",
};

describe("ApartmentSearchForm", () => {
  it("지역·면적·가격·거리 입력과 검색 버튼을 보여준다", () => {
    render(<ApartmentSearchForm />);

    expect(screen.getByLabelText(/^지역/)).toHaveValue("서울 마포구 성산동");
    expect(screen.getByLabelText(/^최소 전용면적/)).toHaveValue(null);
    expect(screen.getByLabelText(/^최대 전용면적/)).toHaveValue(null);
    expect(screen.getByLabelText(/^최소 가격/)).toHaveValue(null);
    expect(screen.getByLabelText(/^최대 가격/)).toHaveValue(null);
    expect(screen.getByLabelText(/^지하철역 거리/)).toHaveValue(null);
    expect(screen.getByLabelText(/^초등학교 거리/)).toHaveValue(null);
    expect(screen.getByRole("button", { name: "아파트 찾기" })).toBeInTheDocument();
  });

  it("실거래 가격이 현재 매물 가격이 아니라 최근 1년 거래 검색 범위라는 안내를 보여준다", () => {
    render(<ApartmentSearchForm />);

    expect(screen.getByText(/현재 매물 가격을 의미하지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText(/최근 1년 동안 선택한 면적과 가격 범위/)).toBeInTheDocument();
  });

  it("검색 버튼을 누르면 입력값으로 아파트 검색 API를 호출한다", async () => {
    const fetchMock = mockFetchJson({ status: "no_match", resolvedRegion: "서울특별시 강남구 대치동" });
    render(<ApartmentSearchForm />);

    await fillAndSubmit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/apartments/search?");
    expect(calledUrl).toContain("region=");
    expect(calledUrl).toContain("minAreaSqm=80");
    expect(calledUrl).toContain("maxPriceManwon=300000");
  });

  it("정상 결과에서 요구된 항목을 모두 보여주고, 거래 내역을 펼쳐볼 수 있다", async () => {
    mockFetchJson({ status: "ok", resolvedRegion: "서울특별시 강남구 대치동", results: [SAMPLE_RESULT] });
    render(<ApartmentSearchForm />);

    await fillAndSubmit();

    expect(await screen.findByText("한티아파트")).toBeInTheDocument();
    expect(screen.getByText("정상 거래 5건")).toBeInTheDocument();
    expect(screen.getByText(/24억원 ~ 26억원/)).toBeInTheDocument();
    expect(screen.getByText(/20억원~30억원 실거래 3건/)).toBeInTheDocument();
    expect(screen.getByText(/2026-06-10 · 25억 5,000만원/)).toBeInTheDocument();
    expect(screen.getByText("한티역")).toBeInTheDocument();
    expect(screen.getByText("대치초등학교")).toBeInTheDocument();

    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "거래 상세 보기" }));

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("2026-06-10")).toBeInTheDocument();
  });

  it("조건에 맞는 아파트가 없으면 지역명과 함께 0건임을 알린다", async () => {
    mockFetchJson({ status: "no_match", resolvedRegion: "서울특별시 강남구 대치동" });
    render(<ApartmentSearchForm />);

    await fillAndSubmit();

    expect(await screen.findByText(/검색은 정상적으로 끝났습니다/)).toBeInTheDocument();
  });

  it("입력 범위가 잘못되면 안내 메시지를 보여준다", async () => {
    mockFetchJson({ status: "invalid_range", message: "전용면적 범위가 올바르지 않습니다." });
    render(<ApartmentSearchForm />);

    await fillAndSubmit();

    expect(await screen.findByText("전용면적 범위가 올바르지 않습니다.")).toBeInTheDocument();
  });

  it("지역을 확인할 수 없으면 안내 메시지를 보여준다", async () => {
    mockFetchJson({ status: "region_not_found", message: '"없는지역"에 해당하는 주소를 찾을 수 없습니다.' });
    render(<ApartmentSearchForm />);

    await fillAndSubmit();

    expect(await screen.findByText('"없는지역"에 해당하는 주소를 찾을 수 없습니다.')).toBeInTheDocument();
  });

  it("지역이 여러 후보로 해석되면 후보 목록을 보여주고 클릭하면 지역 입력값을 채운다", async () => {
    mockFetchJson({
      status: "region_ambiguous",
      message: "여러 지역으로 해석됩니다.",
      candidates: ["서울특별시 강남구 대치동", "서울특별시 강남구 대치1동"],
    });
    render(<ApartmentSearchForm />);

    await fillAndSubmit();

    const candidateButton = await screen.findByRole("button", { name: "서울특별시 강남구 대치1동" });
    const user = userEvent.setup();
    await user.click(candidateButton);

    expect(screen.getByLabelText(/^지역/)).toHaveValue("서울특별시 강남구 대치1동");
  });

  it("국토교통부 데이터를 가져오지 못한 경우와 Kakao 데이터를 가져오지 못한 경우를 다른 문구로 보여준다", async () => {
    mockFetchJson({
      status: "upstream_error",
      source: "molit",
      message: "국토교통부 실거래가 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    });
    render(<ApartmentSearchForm />);
    await fillAndSubmit();
    const molitMessage = await screen.findByText(/국토교통부 실거래가 데이터를 가져오지 못했습니다/);
    expect(molitMessage).toBeInTheDocument();
    cleanup();

    mockFetchJson({
      status: "upstream_error",
      source: "kakao",
      message: "지하철역·초등학교 위치 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    });
    render(<ApartmentSearchForm />);
    await fillAndSubmit();
    expect(await screen.findByText(/지하철역·초등학교 위치 데이터를 가져오지 못했습니다/)).toBeInTheDocument();
  });

  it("서버와 통신 자체에 실패하면 예상하지 못한 오류로 안내한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    render(<ApartmentSearchForm />);

    await fillAndSubmit();

    expect(await screen.findByText(/서버와 통신하지 못했습니다/)).toBeInTheDocument();
  });
});
