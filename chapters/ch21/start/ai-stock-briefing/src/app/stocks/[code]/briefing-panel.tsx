"use client";

import { useState } from "react";

import { formatPrice, formatVolume } from "@/lib/format";
import { formatBaseDate, formatShortDate } from "@/lib/trading-date";
import type { BriefingResult, GroundedBriefingItem } from "@/lib/types";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string; retryable: boolean }
  | { status: "ready"; result: BriefingResult };

export function BriefingPanel({ code }: { code: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function requestBriefing() {
    setState({ status: "loading" });
    try {
      const response = await fetch(`/api/stocks/${encodeURIComponent(code)}/briefing`, { method: "POST" });
      const payload = (await response.json()) as BriefingResult | { error?: string; code?: string; retryable?: boolean };
      if (!response.ok || !("briefing" in payload)) {
        if ("error" in payload) {
          setState({
            status: "error",
            message: payload.error ?? "브리핑을 만들지 못했습니다.",
            retryable: payload.retryable ?? true,
          });
          return;
        }
        throw new Error("브리핑을 만들지 못했습니다.");
      }
      setState({ status: "ready", result: payload });
    } catch (caught) {
      setState({ status: "error", message: caught instanceof Error ? caught.message : "브리핑을 만들지 못했습니다.", retryable: true });
    }
  }

  return (
    <section className="card briefing-card" data-testid="briefing-panel">
      <header className="briefing-intro">
        <div>
          <span className="ai-label">근거 기반 AI 브리핑</span>
          <h2>주가와 공시를 한 번에 읽어 봅니다</h2>
          <p>화면에서 확인한 금융위원회·OpenDART 자료만 Gemini에 보내 읽기 쉽게 정리합니다.</p>
        </div>
        <button type="button" onClick={requestBriefing} disabled={state.status === "loading" || (state.status === "error" && !state.retryable)}>
          {state.status === "loading" ? "근거를 확인하는 중…" : state.status === "ready" ? "다시 브리핑" : state.status === "error" && !state.retryable ? "Gemini 한도 갱신 대기" : "AI 브리핑 만들기"}
        </button>
      </header>

      {state.status === "idle" && (
        <p className="briefing-boundary">AI는 추천·목표주가·가격 예측을 하지 않으며, 공시와 가격의 인과관계를 단정하지 않습니다.</p>
      )}
      {state.status === "error" && (
        <p className="notice error" role="alert">
          <strong>AI 브리핑을 표시하지 못했습니다</strong>
          <span>{state.message}</span>
        </p>
      )}
      {state.status === "ready" && <BriefingView result={state.result} />}
    </section>
  );
}
function BriefingList({ title, items }: { title: string; items: GroundedBriefingItem[] }) {
  return (
    <section>
      <h3>{title}</h3>
      <ul>{items.map((item, index) => <li key={`${title}-${index}`}>{item.text}</li>)}</ul>
    </section>
  );
}

function BriefingView({ result }: { result: BriefingResult }) {
  const { packet, briefing } = result;
  const history = packet.priceHistory;
  return (
    <div className="briefing-result" data-testid="briefing-result">
      <div className="verified-facts">
        <span className="fact-label">프로그램이 확인한 사실</span>
        <h3>{packet.stock.name} · {formatBaseDate(packet.stock.quoteBaseDate)}</h3>
        <dl>
          <div><dt>현재가</dt><dd>{formatPrice(packet.stock.close)}원</dd></div>
          <div><dt>기준가</dt><dd>{formatPrice(packet.stock.basePrice)}원</dd></div>
          <div><dt>실제 가격 구간</dt><dd>{formatShortDate(history.from)} ~ {formatShortDate(history.to)}</dd></div>
          <div><dt>거래일</dt><dd>{history.tradingDays.toLocaleString("ko-KR")}일</dd></div>
          <div><dt>구간 최고가</dt><dd>{formatPrice(history.highestHigh)}원</dd></div>
          <div><dt>구간 최저가</dt><dd>{formatPrice(history.lowestLow)}원</dd></div>
          <div><dt>최근 거래량</dt><dd>{formatVolume(packet.stock.volume)}</dd></div>
          <div><dt>공시</dt><dd>{packet.filings.totalCount.toLocaleString("ko-KR")}건</dd></div>
        </dl>
      </div>

      <div className="ai-explanation">
        <span className="ai-label">AI가 근거를 읽고 정리한 설명</span>
        <h3>{briefing.headline}</h3>
        <section className="briefing-highlights" data-testid="briefing-highlights">
          <h3>핵심 브리핑</h3>
          <ul>{briefing.highlights.map((item, index) => <li key={`핵심 브리핑-${index}`}>{item.text}</li>)}</ul>
        </section>
        <div className="briefing-grid">
          <BriefingList title="시장과 종목 비교" items={briefing.marketContext} />
          <BriefingList title="최근 가격 흐름" items={briefing.priceContext} />
          <BriefingList title={`최근 1년간 회사 공시 (총 ${packet.filings.totalCount.toLocaleString("ko-KR")}건)`} items={briefing.filingContext} />
          <BriefingList title="현재 근거만으로 알 수 없는 것" items={briefing.unknowns} />
        </div>
      </div>

      {packet.filings.representative.length > 0 && (
        <section className="briefing-filings">
          <h3>브리핑에 사용한 대표 공시</h3>
          <p>전체 공시 {packet.filings.totalCount.toLocaleString("ko-KR")}건 중 OpenDART 공식 유형과 접수일 기준으로 고른 {packet.filings.representative.length.toLocaleString("ko-KR")}건입니다.</p>
          <ul>
            {packet.filings.representative.map((filing) => (
              <li key={filing.receiptNo}>
                <span>{formatShortDate(filing.receiptDate)}</span>
                <a href={filing.documentUrl} target="_blank" rel="noreferrer noopener">{filing.reportName} ↗</a>
                <small>{filing.disclosureTypeLabel} · 제출인 {filing.filerName}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="briefing-sources">
        <strong>기준일과 출처</strong>
        <span>종목 {formatBaseDate(packet.stock.quoteBaseDate)} · 지수 {packet.market.indexBaseDate ? formatBaseDate(packet.market.indexBaseDate) : "자료별 기준일 표시"}</span>
        {packet.references.map((reference) => <a key={reference.id} href={reference.url} target="_blank" rel="noreferrer noopener">{reference.label} ↗</a>)}
        <span className="model-note">AI 설명 생성 모델: {result.model} · 숫자는 프로그램 계산값</span>
      </footer>
    </div>
  );
}
