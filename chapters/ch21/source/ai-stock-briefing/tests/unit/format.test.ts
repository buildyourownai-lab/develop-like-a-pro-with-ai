import assert from "node:assert/strict";
import { test } from "node:test";

import {
  directionLabel,
  directionMark,
  directionOf,
  formatSignedRate,
  formatTradeValue,
  formatVolume,
} from "../../src/lib/format";

test("상승·하락·보합을 색이 아닌 값으로 구분한다", () => {
  assert.equal(directionOf(1.2), "up");
  assert.equal(directionOf(-1.2), "down");
  assert.equal(directionOf(0), "flat");

  assert.equal(directionMark("up"), "▲");
  assert.equal(directionMark("down"), "▼");
  assert.equal(directionLabel("down"), "하락");
});

test("등락률에는 항상 부호를 붙인다", () => {
  assert.equal(formatSignedRate(2.19), "+2.19%");
  assert.equal(formatSignedRate(-2.19), "-2.19%");
  assert.equal(formatSignedRate(0), "0.00%");
});

test("거래대금을 조·억 단위로 줄여 읽는다", () => {
  assert.equal(formatTradeValue(6_742_432_203_720), "6.7조원");
  assert.equal(formatTradeValue(4_499_131_101), "45억원");
  assert.equal(formatTradeValue(0), "0원");
});

test("거래량을 만·억주 단위로 줄여 읽는다", () => {
  assert.equal(formatVolume(24_464_621), "2,446만주");
  assert.equal(formatVolume(500), "500주");
});
