"use client";

import { FormEvent, ReactNode, useState } from "react";
import type { ApartmentComplexResult, ApartmentSearchOutcome } from "@/lib/apartmentSearch";

type SearchInput = {
  region: string;
  minAreaM2: string;
  maxAreaM2: string;
  minPriceManwon: string;
  maxPriceManwon: string;
  maxSubwayDistanceM: string;
  maxElementaryDistanceM: string;
};
type SearchErrorCode = "REGION_ERROR" | "INVALID_INPUT" | "MOLIT_DATA_ERROR" | "KAKAO_DATA_ERROR" | "SERVER_ERROR";
type SearchErrorResponse = { error: { code: SearchErrorCode; message: string; suggestions?: string[] } };
type ApartmentResult = {
  id: string;
  name: string;
  matchedAddress: string;
  normalTransactionCount: number;
  priceRangeManwon: { min: number; max: number };
  priceRangeTransactionCount: number;
  latestDate: string;
  latestTransactions: { amountManwon: number }[];
  conditions: { id: "subway" | "elementarySchool"; place: { name: string; distanceM: number } }[];
  transactions: { date: string; amountManwon: number; areaM2: number; floor: number | null }[];
};
type SearchResult = {
  candidates: ApartmentResult[];
  resolvedRegion: { name: string };
  period: { from: string; to: string };
  queriedOn: string;
  query: { minPriceManwon: number; maxPriceManwon: number };
  limitations: string[];
};

const defaults: SearchInput = {
  region: "서울 마포구 성산동",
  minAreaM2: "",
  maxAreaM2: "",
  minPriceManwon: "",
  maxPriceManwon: "",
  maxSubwayDistanceM: "",
  maxElementaryDistanceM: "",
};

const money = (value: number) => {
  const eok = Math.floor(value / 10000);
  const manwon = value % 10000;
  return `${eok ? `${eok}억${manwon ? "" : "원"}` : ""}${manwon ? ` ${manwon.toLocaleString("ko-KR")}만원` : ""}`.trim();
};

const meters = (value: number) => `${value.toLocaleString("ko-KR")}m`;

const errorTitles: Record<SearchErrorCode, string> = {
  REGION_ERROR: "지역을 확인해 주세요.",
  INVALID_INPUT: "입력 조건을 확인해 주세요.",
  MOLIT_DATA_ERROR: "실거래 데이터를 가져오지 못했습니다.",
  KAKAO_DATA_ERROR: "위치 데이터를 가져오지 못했습니다.",
  SERVER_ERROR: "검색을 완료하지 못했습니다.",
};

function toApartmentResult(apartment: ApartmentComplexResult): ApartmentResult {
  return {
    id: `${apartment.legalDong}|${apartment.jibun}|${apartment.aptName}`,
    name: apartment.aptName,
    matchedAddress: `${apartment.legalDong} ${apartment.jibun}`,
    normalTransactionCount: apartment.tradeCountInAreaRange,
    priceRangeManwon: apartment.priceRangeManwonInAreaRange,
    priceRangeTransactionCount: apartment.tradeCountInPriceRange,
    latestDate: apartment.latestTrade.dealDate,
    latestTransactions: [{ amountManwon: apartment.latestTrade.dealAmountManwon }],
    conditions: [
      { id: "subway", place: { name: apartment.nearestSubway.name, distanceM: apartment.nearestSubway.distanceMeters } },
      { id: "elementarySchool", place: { name: apartment.nearestElementarySchool.name, distanceM: apartment.nearestElementarySchool.distanceMeters } },
    ],
    transactions: apartment.matchingTrades.map((transaction) => ({
      date: transaction.dealDate,
      amountManwon: transaction.dealAmountManwon,
      areaM2: transaction.exclusiveAreaSqm,
      floor: transaction.floor,
    })),
  };
}

function toSearchError(
  outcome: Exclude<ApartmentSearchOutcome, { status: "ok" | "no_match" }>,
): SearchErrorResponse["error"] {
  if (outcome.status === "invalid_range") {
    return { code: "INVALID_INPUT", message: outcome.message };
  }
  if (outcome.status === "region_not_found") {
    return { code: "REGION_ERROR", message: outcome.message };
  }
  if (outcome.status === "region_ambiguous") {
    return { code: "REGION_ERROR", message: outcome.message, suggestions: outcome.candidates };
  }
  return {
    code: outcome.source === "molit"
      ? "MOLIT_DATA_ERROR"
      : outcome.source === "kakao"
        ? "KAKAO_DATA_ERROR"
        : "SERVER_ERROR",
    message: outcome.message,
  };
}

/*
  조건을 한 줄로 늘어놓으면 기본 HTML Form처럼 보인다.
  뜻이 같은 것끼리 묶고, 그 묶음이 무엇을 정하는지 왼쪽에 적어 둔다.
  fieldset의 legend는 grid 안에서 브라우저마다 다르게 놓이므로 role로 같은 뜻을 만든다.
*/
function Group({ id, title, note, children }: { id: string; title: string; note: string; children: ReactNode }) {
  return (
    <div className="group" role="group" aria-labelledby={`${id}-title`}>
      <div className="group-head">
        <p className="group-title" id={`${id}-title`}>{title}</p>
        <p className="group-note">{note}</p>
      </div>
      <div className="group-fields">{children}</div>
    </div>
  );
}

/*
  카드는 모두 같은 자리에 같은 항목을 둔다. 그래서 위아래로 훑기만 해도 후보끼리 비교된다.
  가장 중요한 값은 색이 아니라 크기로 앞세우고, 날짜·거리·건수는 보조로 내린다.
*/
function ApartmentCard({
  apartment,
  priceRange,
}: {
  apartment: ApartmentResult;
  priceRange: { min: number; max: number };
}) {
  const [expanded, setExpanded] = useState(false);
  const subway = apartment.conditions.find((condition) => condition.id === "subway")!;
  const school = apartment.conditions.find((condition) => condition.id === "elementarySchool")!;
  return (
    <article className="result-card" data-testid="apartment-card">
      <div className="result-heading">
        <div className="result-title">
          <h3>{apartment.name}</h3>
          <p>{apartment.matchedAddress}</p>
        </div>
        <span className="count-badge">정상 거래 {apartment.normalTransactionCount}건</span>
      </div>

      <dl className="headline">
        <dt>최근 1년 실거래 가격</dt>
        <dd>{money(apartment.priceRangeManwon.min)} ~ {money(apartment.priceRangeManwon.max)}</dd>
      </dl>

      <dl className="facts">
        <div>
          <dt>입력한 가격 범위 안</dt>
          <dd>{money(priceRange.min)}~{money(priceRange.max)} 실거래 {apartment.priceRangeTransactionCount}건</dd>
        </div>
        <div>
          <dt>가장 최근 거래</dt>
          <dd>{apartment.latestDate} · {apartment.latestTransactions.map((item) => money(item.amountManwon)).join(", ")}</dd>
        </div>
        <div>
          <dt>가장 가까운 지하철역</dt>
          <dd><b>{subway.place.name}</b> · {meters(subway.place.distanceM)}</dd>
        </div>
        <div>
          <dt>가장 가까운 초등학교</dt>
          <dd><b>{school.place.name}</b> · {meters(school.place.distanceM)}</dd>
        </div>
      </dl>

      <div className="card-actions">
        <button className="detail-button" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "거래 상세 닫기" : "거래 상세 보기"}
        </button>
      </div>

      {expanded && (
        <div className="transactions" data-testid="transaction-details">
          <table>
            <thead><tr><th>계약일</th><th className="num">가격</th><th className="num">전용면적</th><th className="num">층</th></tr></thead>
            <tbody>
              {[...apartment.transactions].reverse().map((transaction, index) => (
                <tr key={`${transaction.date}-${transaction.amountManwon}-${transaction.areaM2}-${transaction.floor}-${index}`}>
                  <td>{transaction.date}</td><td className="num">{money(transaction.amountManwon)}</td>
                  <td className="num">{transaction.areaM2}㎡</td><td className="num">{transaction.floor ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

export default function SearchForm() {
  const [input, setInput] = useState(defaults);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<{ code: SearchErrorCode; message: string; suggestions?: string[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const setNumber = (key: keyof SearchInput, value: string) =>
    setInput((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({
        region: input.region,
        minAreaSqm: input.minAreaM2,
        maxAreaSqm: input.maxAreaM2,
        minPriceManwon: input.minPriceManwon,
        maxPriceManwon: input.maxPriceManwon,
        maxSubwayDistanceMeters: input.maxSubwayDistanceM,
        maxSchoolDistanceMeters: input.maxElementaryDistanceM,
      });
      const response = await fetch(`/api/apartments/search?${params.toString()}`);
      const payload = (await response.json()) as ApartmentSearchOutcome;
      if (payload.status === "ok" || payload.status === "no_match") {
        const queriedOn = new Date().toISOString().slice(0, 10);
        const from = `${Number(queriedOn.slice(0, 4)) - 1}${queriedOn.slice(4)}`;
        const candidates = payload.status === "ok"
          ? payload.results.map(toApartmentResult)
          : [];
        setResult({
          candidates,
          resolvedRegion: { name: payload.resolvedRegion },
          period: { from, to: queriedOn },
          queriedOn,
          query: {
            minPriceManwon: Number(input.minPriceManwon),
            maxPriceManwon: Number(input.maxPriceManwon),
          },
          limitations: [
            "현재 판매 중인 매물이나 추천 순위가 아니라 최근 1년의 실제 거래 기록입니다.",
            "지하철역·초등학교 거리는 Kakao가 계산한 좌표 사이 직선거리입니다.",
            "실거래 자료는 취소·정정되거나 새로 추가될 수 있습니다.",
          ],
        });
        return;
      }
      setError(toSearchError(payload));
    } catch (caught) {
      setError({
        code: "SERVER_ERROR",
        message: caught instanceof Error && caught.message
          ? "서버와 통신하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
          : "검색 처리 중 예상하지 못한 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form className="search-panel" onSubmit={submit}>
        <div className="panel-head">
          <h2>검색 조건</h2>
          <p className="panel-note">최근 1년 실거래 자료에서 찾습니다</p>
        </div>

        <Group id="region" title="위치" note="행정동·법정동·도로명주소를 입력하면 실제 주소 관계를 확인합니다.">
          <label className="wide">지역<span>시·군·구와 동 또는 도로명주소</span>
            <input name="region" required value={input.region} onChange={(event) => setInput({ ...input, region: event.target.value })} />
          </label>
        </Group>

        <Group id="area" title="전용면적" note="분양 평수가 아니라 실거래 신고에 쓰이는 전용면적입니다.">
          <label>최소 전용면적<span>㎡, 포함</span>
            <input name="minAreaM2" type="number" required min="0" step="0.01" value={input.minAreaM2} onChange={(event) => setNumber("minAreaM2", event.target.value)} />
          </label>
          <label>최대 전용면적<span>㎡, 포함</span>
            <input name="maxAreaM2" type="number" required min="0" step="0.01" value={input.maxAreaM2} onChange={(event) => setNumber("maxAreaM2", event.target.value)} />
          </label>
        </Group>

        <Group
          id="price"
          title="실거래 가격"
          note="최근 1년 동안 선택한 면적과 가격 범위로 실제 거래된 기록이 있는 단지를 찾습니다. 현재 매물 가격을 의미하지 않습니다."
        >
          <label>최소 가격<span>만원, 포함</span>
            <input name="minPriceManwon" type="number" required min="0" step="1000" value={input.minPriceManwon} onChange={(event) => setNumber("minPriceManwon", event.target.value)} />
          </label>
          <label>최대 가격<span>만원, 포함</span>
            <input name="maxPriceManwon" type="number" required min="0" step="1000" value={input.maxPriceManwon} onChange={(event) => setNumber("maxPriceManwon", event.target.value)} />
          </label>
        </Group>

        <Group id="lifestyle" title="생활 조건" note="Kakao가 계산한 좌표 사이 직선거리이며 보행거리와 다릅니다.">
          <label>지하철역 거리<span>m 이내</span>
            <input name="maxSubwayDistanceM" type="number" required min="1" max="20000" value={input.maxSubwayDistanceM} onChange={(event) => setNumber("maxSubwayDistanceM", event.target.value)} />
          </label>
          <label>초등학교 거리<span>m 이내</span>
            <input name="maxElementaryDistanceM" type="number" required min="1" max="20000" value={input.maxElementaryDistanceM} onChange={(event) => setNumber("maxElementaryDistanceM", event.target.value)} />
          </label>
        </Group>

        <div className="panel-foot">
          <button className="search-button" type="submit" disabled={loading}>{loading ? "찾는 중…" : "아파트 찾기"}</button>
          <p className="panel-hint">검색할 때 실제 데이터를 가져옵니다.</p>
        </div>
      </form>

      <section className="results" aria-live="polite">
        {loading && (
          <div className="status">
            <strong>실제 자료를 확인하고 있습니다.</strong>
            <p>국토교통부 실거래가 자료를 받아 조건에 맞는 거래를 고르고, 단지마다 가까운 지하철역과 초등학교를 확인합니다.</p>
          </div>
        )}

        {error && (
          <div className={`status error ${error.code.toLowerCase()}`} role="alert" data-error-code={error.code}>
            <strong>{errorTitles[error.code]}</strong>
            <p>{error.message}</p>
            {error.suggestions && error.suggestions.length > 0 && (
              <div className="region-suggestions">
                {error.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      setInput((current) => ({ ...current, region: suggestion }));
                      setError(null);
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {result && result.candidates.length === 0 && (
          <div className="status empty">
            <strong>조건을 모두 만족한 단지가 없습니다.</strong>
            <p>검색은 정상적으로 끝났습니다. 면적·가격·거리 조건을 넓혀서 다시 찾아보세요.</p>
          </div>
        )}

        {result && result.candidates.length > 0 && (
          <>
            <div className="results-head">
              <div>
                <h2>조건에 맞는 단지 {result.candidates.length}곳</h2>
                <p className="results-basis">
                  {result.resolvedRegion.name} · 최근 1년 실거래 {result.period.from} ~ {result.period.to} · 조회 기준일 {result.queriedOn}
                </p>
              </div>
              <p className="results-note">점수나 순위 없이 단지 이름 순으로 나열합니다.</p>
            </div>

            <div className="result-list">
              {result.candidates.map((apartment) => (
                <ApartmentCard
                  key={apartment.id}
                  apartment={apartment}
                  priceRange={{ min: result.query.minPriceManwon, max: result.query.maxPriceManwon }}
                />
              ))}
            </div>

            <p className="source-note">출처 · 국토교통부 아파트 매매 실거래가 자료, Kakao 지역 정보</p>

            <aside className="limitations">
              <h2>결과를 읽기 전에</h2>
              <ul>{result.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
            </aside>
          </>
        )}
      </section>
    </>
  );
}
