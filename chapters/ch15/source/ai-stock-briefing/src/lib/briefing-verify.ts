import type { BriefingFacts } from "./briefing-facts";
import { buildFactsBlock } from "./briefing-facts-block";

function extractNumberTokens(text: string): string[] {
  return text.match(/\d+(\.\d+)?/g) ?? [];
}

// facts에 실제로 들어간 모든 숫자를 문자열 형태로 모은다. 가격·등락률 같은
// 계산값뿐 아니라, 날짜(연/월/일)와 공시 제목·제출인 안의 숫자까지 전부
// 포함한다 — Gemini가 그 문장들을 그대로 옮겨 쓸 때 나오는 숫자이기 때문.
function collectAllowedNumberTokens(facts: BriefingFacts): Set<string> {
  const tokens = new Set<string>();

  function addNumber(n: number | null | undefined) {
    if (n === null || n === undefined || Number.isNaN(n)) return;
    const abs = Math.abs(n);
    tokens.add(String(abs));
    tokens.add(abs.toFixed(1));
    tokens.add(abs.toFixed(2));
    tokens.add(String(Math.trunc(abs)));
  }

  function addText(text: string | null | undefined) {
    if (!text) return;
    for (const t of extractNumberTokens(text)) tokens.add(t);
  }

  function addDateParts(basDt: string | null | undefined) {
    if (!basDt || basDt.length !== 8) return;
    const y = basDt.slice(0, 4);
    const m = basDt.slice(4, 6);
    const d = basDt.slice(6, 8);
    tokens.add(y);
    tokens.add(m);
    tokens.add(String(Number(m)));
    tokens.add(d);
    tokens.add(String(Number(d)));
  }

  addNumber(facts.stock.price);
  addNumber(facts.stock.change);
  addNumber(facts.stock.changeRate);
  addDateParts(facts.stock.baseDate);
  addText(facts.stock.code);
  tokens.add(String(Number(facts.stock.code)));
  addText(facts.stock.name);
  addText(facts.generatedAt);

  for (const m of facts.marketComparison) {
    addNumber(m.indexChangeRate);
    addNumber(m.stockChangeRate);
    addNumber(m.deltaPp);
    addDateParts(m.indexBaseDate);
  }

  const pf = facts.priceFlow;
  addNumber(pf.currentPrice);
  addNumber(pf.currentChangeRate);
  addDateParts(pf.currentBaseDate);
  addNumber(pf.periodStartPrice);
  addDateParts(pf.periodStartDate);
  addNumber(pf.periodEndPrice);
  addDateParts(pf.periodEndDate);
  addNumber(pf.periodChangeRate);
  if (pf.yearHigh) {
    addNumber(pf.yearHigh.price);
    addDateParts(pf.yearHigh.basDt);
  }
  if (pf.yearLow) {
    addNumber(pf.yearLow.price);
    addDateParts(pf.yearLow.basDt);
  }
  addNumber(pf.noTradeDayCount);

  addNumber(facts.disclosures.totalCount);
  addNumber(facts.disclosures.items.length);
  addDateParts(facts.disclosures.beginDate);
  addDateParts(facts.disclosures.endDate);
  for (const item of facts.disclosures.items) {
    addDateParts(item.receiptDate);
    addText(item.reportName);
    addText(item.submitter);
  }

  // 위 필드를 하나씩 훑는 것만으로는 부족하다. Gemini가 실제로 읽는 것은
  // 필드가 아니라 우리가 만들어 보낸 사실 블록 문장이고, 그 문장에는 "최근
  // 1년 공시"·"1년 전 시작가"처럼 우리가 쓴 숫자가 들어 있다. Gemini는 그
  // 표현을 그대로 옮겨 쓰기 때문에 이것을 허용하지 않으면 정상 브리핑이
  // "우리가 주지 않은 숫자(1)"로 막힌다. 그래서 우리가 보낸 문장 자체의
  // 숫자를 기준에 함께 넣는다 — 천 단위 쉼표는 먼저 지워야 "1,730,000"이
  // "1"·"730"·"000"으로 잘못 쪼개지지 않는다.
  addText(stripThousandsSeparators(buildFactsBlock(facts)));

  return tokens;
}

// "1,331" 같은 천 단위 구분 쉼표를 지운다 — 없으면 "1"과 "331"로 잘못
// 쪼개져 실제로는 허용된 숫자를 모르는 숫자로 잘못 판정하게 된다.
function stripThousandsSeparators(text: string): string {
  // 그룹이 3개 이상(10억 이상, 예: "9,999,999,999")이면 인접한 그룹 하나씩
  // 지우는 방식으로는 가운데에 쉼표가 하나 남을 수 있다(실제로 테스트에서
  // 발견함). 그 대신 "1~3자리 숫자 뒤에 ,000 그룹이 하나 이상 이어지는"
  // 전체 구간을 한 번에 찾아, 그 구간 안의 쉼표만 통째로 지운다.
  return text.replace(/\d{1,3}(,\d{3})+/g, (match) => match.replace(/,/g, ""));
}

// Gemini가 만든 문장에 우리가 준 사실에는 없는 숫자가 들어갔는지 프로그램이
// 직접 확인한다 — 이 검사는 다시 LLM에게 판단을 맡기지 않는다. 판단이
// 애매한 경우 모르는 숫자로 취급한다(안전하게 걸러내는 쪽을 택한다).
export function findUnknownNumbers(text: string, facts: BriefingFacts): string[] {
  const allowed = collectAllowedNumberTokens(facts);
  const normalized = stripThousandsSeparators(text);
  const unknown = new Set<string>();
  for (const raw of extractNumberTokens(normalized)) {
    if (allowed.has(raw)) continue;
    const withoutTrailingZeros = raw.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    if (allowed.has(withoutTrailingZeros)) continue;
    unknown.add(raw);
  }
  return [...unknown];
}
