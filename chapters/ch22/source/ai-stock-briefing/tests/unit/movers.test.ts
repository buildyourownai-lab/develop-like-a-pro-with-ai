import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isCommonStock,
  isSpac,
  rankMovers,
  rankable,
  toAscendingBars,
  toStockQuote,
} from "../../src/lib/movers";
import { SAMPLE_HISTORY, SAMPLE_QUOTES } from "./fixture";

test("원본 문자열 필드를 숫자로 바꿔 담는다", () => {
  const quote = toStockQuote(SAMPLE_QUOTES[0]);
  assert.equal(quote.code, "100010");
  assert.equal(quote.close, 10000);
  assert.equal(quote.changeRate, 12.5);
  assert.equal(quote.tradeValue, 50_000_000_000);
  assert.equal(quote.baseDate, "20260818");
});

test("보통주 종목코드만 통과한다", () => {
  assert.ok(isCommonStock("000660"));
  assert.ok(!isCommonStock("000665"), "우선주는 보통주가 아니다");
  assert.ok(!isCommonStock("00088K"), "K로 끝나는 우선주는 보통주가 아니다");
  assert.ok(!isCommonStock("005389"), "9로 끝나는 우선주는 보통주가 아니다");
});

test("스팩을 가려낸다", () => {
  assert.ok(isSpac("교보18호스팩"));
  assert.ok(isSpac("가상기업인수목적1호"));
  assert.ok(!isSpac("SK하이닉스"));
});

test("순위 집계 대상에서 우선주·스팩·KONEX·미거래·소액거래를 뺀다", () => {
  const excluded = SAMPLE_QUOTES.map(toStockQuote)
    .filter((quote) => !rankable(quote))
    .map((quote) => quote.name);

  assert.deepEqual(excluded.sort(), [
    "가상거래정지",
    "가상소액",
    "가상전자2우B",
    "가상전자우",
    "가상제1호스팩",
    "가상코넥스",
  ]);
});

test("등락률 순서로 상승·하락 상위 종목을 뽑는다", () => {
  const { gainers, losers, rankedCount } = rankMovers(SAMPLE_QUOTES.map(toStockQuote), 3);

  assert.equal(rankedCount, 6, "집계 대상은 6종목이다");
  assert.deepEqual(gainers.map((quote) => quote.name), ["가상소재", "가상전자", "가상화학"]);
  assert.deepEqual(losers.map((quote) => quote.name), ["가상바이오", "가상중공업", "가상통신"]);
});

test("상승 1위와 하락 1위가 섞이지 않는다", () => {
  const { gainers, losers } = rankMovers(SAMPLE_QUOTES.map(toStockQuote));
  assert.ok(gainers[0].changeRate > 0);
  assert.ok(losers[0].changeRate < 0);
});

test("차트 자료는 요청한 종목만 남기고 날짜 오름차순으로 정렬한다", () => {
  const bars = toAscendingBars(SAMPLE_HISTORY, "900000");

  assert.deepEqual(bars.map((bar) => bar.date), ["20260813", "20260814", "20260818"]);
  assert.equal(bars.at(-1)?.close, 12000);
  assert.equal(bars.at(-1)?.open, 11000);
  assert.equal(bars.at(-1)?.high, 12500);
  assert.equal(bars.at(-1)?.low, 10900);
  assert.equal(bars.at(-1)?.volume, 500);
});

test("차트 한 칸에는 시가·고가·저가·종가·거래량이 모두 들어 있다", () => {
  for (const bar of toAscendingBars(SAMPLE_HISTORY, "900000")) {
    for (const key of ["open", "high", "low", "close", "volume"] as const) {
      assert.equal(typeof bar[key], "number", `${key}가 숫자여야 한다`);
    }
    assert.ok(bar.high >= bar.low, "고가는 저가보다 크거나 같다");
    assert.ok(bar.high >= bar.close && bar.close >= bar.low, "종가는 고가와 저가 사이에 있다");
  }
});
