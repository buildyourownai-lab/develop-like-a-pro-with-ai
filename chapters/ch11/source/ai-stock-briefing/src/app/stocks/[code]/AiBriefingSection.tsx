"use client";
import { useState, useTransition } from "react";
import { generateStockBriefingAction, type BriefingActionResult } from "./briefing-actions";
import { formatBaseDateLabel, formatPrice, formatShortDate, formatVolume } from "@/lib/format";
import styles from "./stock.module.css";

export function AiBriefingSection({ code }: { code: string }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<BriefingActionResult | null>(null);
  function requestBriefing() {
    setResult(null);
    startTransition(async () => {
      try { setResult(await generateStockBriefingAction(code)); }
      catch { setResult({ error: "브리핑을 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.", retryable: true }); }
    });
  }
  const ready = result && "facts" in result && "briefing" in result ? result : null;
  const retryable = !result || !("retryable" in result) || result.retryable;
  return <section className={styles.briefingCard} data-testid="briefing-panel">
    <header className={styles.briefingIntro}><div><span className={styles.aiLabel}>근거 기반 AI 브리핑</span><h2>주가와 공시를 한 번에 읽어 봅니다</h2><p>화면에서 확인한 금융위원회·OpenDART 자료만 Gemini에 보내 읽기 쉽게 정리합니다.</p></div><button type="button" onClick={requestBriefing} disabled={isPending || !retryable}>{isPending ? "근거를 확인하는 중…" : ready ? "다시 브리핑" : !retryable ? "Gemini 설정 확인 필요" : "AI 브리핑 만들기"}</button></header>
    {!result && <p className={styles.briefingBoundary}>AI는 추천·목표주가·가격 예측을 하지 않으며, 공시와 가격의 인과관계를 단정하지 않습니다.</p>}
    {result && "error" in result && <ErrorNotice message={result.error} />}
    {result && "facts" in result && "aiError" in result && <div className={styles.briefingResult}><VerifiedFacts facts={result.facts} /><div className={styles.aiExplanation}><span className={styles.aiLabel}>AI가 근거를 읽고 정리한 설명</span><ErrorNotice message={result.aiError} /></div></div>}
    {ready && <BriefingView result={ready} code={code} />}
  </section>;
}

function ErrorNotice({ message }: { message: string }) { return <p className={`${styles.notice} ${styles.error}`} role="alert"><strong>AI 브리핑을 표시하지 못했습니다</strong><span>{message}</span></p>; }
type Facts = Extract<BriefingActionResult, { facts: unknown }>["facts"];

function VerifiedFacts({ facts }: { facts: Facts }) {
  const flow = facts.priceFlow;
  return <div className={styles.verifiedFacts}><span className={styles.factLabel}>프로그램이 확인한 사실</span><h3>{facts.stock.name} · {formatBaseDateLabel(facts.stock.baseDate)}</h3><dl>
    <div><dt>현재가</dt><dd>{formatPrice(facts.stock.price)}</dd></div><div><dt>기준가</dt><dd>{formatPrice(facts.stock.price - facts.stock.change)}</dd></div>
    <div><dt>실제 가격 구간</dt><dd>{formatShortDate(flow.periodStartDate)} ~ {formatShortDate(flow.periodEndDate)}</dd></div><div><dt>거래일</dt><dd>{flow.tradingDayCount.toLocaleString("ko-KR")}일</dd></div>
    <div><dt>구간 최고가</dt><dd>{flow.yearHigh ? formatPrice(flow.yearHigh.price) : "계산 불가"}</dd></div><div><dt>구간 최저가</dt><dd>{flow.yearLow ? formatPrice(flow.yearLow.price) : "계산 불가"}</dd></div>
    <div><dt>최근 거래량</dt><dd>{formatVolume(flow.currentVolume)}</dd></div><div><dt>공시</dt><dd>{facts.disclosures.totalCount.toLocaleString("ko-KR")}건</dd></div>
  </dl></div>;
}

function ItemList({ title, items }: { title: string; items: Array<{ text: string }> }) { return <section><h3>{title}</h3><ul>{items.map((item, index) => <li key={`${title}-${index}`}>{item.text}</li>)}</ul></section>; }
function BriefingView({ result, code }: { result: Extract<BriefingActionResult, { briefing: unknown }>; code: string }) {
  const { facts, briefing } = result;
  const representative = facts.disclosures.representative ?? [];
  return <div className={styles.briefingResult} data-testid="briefing-result"><VerifiedFacts facts={facts} /><div className={styles.aiExplanation}><span className={styles.aiLabel}>AI가 근거를 읽고 정리한 설명</span><h3>{briefing.headline}</h3><section className={styles.briefingHighlights} data-testid="briefing-highlights"><h3>핵심 브리핑</h3><ul>{briefing.highlights.map((item, index) => <li key={index}>{item.text}</li>)}</ul></section><div className={styles.briefingGrid}><ItemList title="시장과 종목 비교" items={briefing.marketContext} /><ItemList title="최근 가격 흐름" items={briefing.priceContext} /><ItemList title={`최근 1년간 회사 공시 (총 ${facts.disclosures.totalCount.toLocaleString("ko-KR")}건)`} items={briefing.filingContext} /><ItemList title="현재 근거만으로 알 수 없는 것" items={briefing.unknowns} /></div></div>
    {representative.length > 0 && <section className={styles.briefingFilings}><h3>브리핑에 사용한 대표 공시</h3><p>전체 공시 {facts.disclosures.totalCount.toLocaleString("ko-KR")}건 중 OpenDART 공식 유형과 접수일 기준으로 고른 {representative.length.toLocaleString("ko-KR")}건입니다.</p><ul>{representative.map((filing) => <li key={filing.receiptNo}><span>{formatShortDate(filing.receiptDate)}</span><a href={filing.dartUrl} target="_blank" rel="noreferrer noopener">{filing.reportName} ↗</a><small>{filing.disclosureTypeLabel} · 제출인 {filing.submitter}</small></li>)}</ul><a href={`/stocks/${code}/disclosures`}>전체 공시 보기</a></section>}
    <footer className={styles.briefingSources}><strong>기준일과 출처</strong><span>종목 {formatBaseDateLabel(facts.stock.baseDate)} · 지수 자료별 기준일 표시</span>{result.packet.references.map((reference) => <a key={reference.id} href={reference.url} target="_blank" rel="noreferrer noopener">{reference.label} ↗</a>)}<span className={styles.modelNote}>AI 설명 생성 모델: {result.model} · 숫자는 프로그램 계산값</span></footer>
  </div>;
}
