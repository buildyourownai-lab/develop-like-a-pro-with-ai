import type { RawStockPrice } from "../../src/lib/types";

/**
 * 합성 fixture다. 실제 응답의 필드 이름과 값 모양만 그대로 따랐고 값은 시험용으로 지어냈다.
 * Live 응답과 섞이지 않도록 이 파일에서만 쓴다.
 */
function row(over: Partial<RawStockPrice>): RawStockPrice {
  return {
    basDt: "20260818",
    srtnCd: "900000",
    isinCd: "TEST90000000",
    itmsNm: "테스트 종목",
    mrktCtg: "KOSPI",
    clpr: "10000",
    vs: "0",
    fltRt: "0",
    mkp: "10000",
    hipr: "10000",
    lopr: "10000",
    trqu: "1000",
    trPrc: "10000000000",
    lstgStCnt: "1000000",
    mrktTotAmt: "10000000000",
    ...over,
  };
}

export const SAMPLE_QUOTES: RawStockPrice[] = [
  row({ srtnCd: "100010", itmsNm: "가상소재", fltRt: "12.5", trPrc: "50000000000" }),
  row({ srtnCd: "100020", itmsNm: "가상전자", fltRt: "8.1", trPrc: "20000000000" }),
  row({ srtnCd: "100030", itmsNm: "가상바이오", fltRt: "-15.2", trPrc: "30000000000" }),
  row({ srtnCd: "100040", itmsNm: "가상중공업", fltRt: "-3.4", trPrc: "40000000000" }),
  row({ srtnCd: "100050", itmsNm: "가상화학", fltRt: "1.1", trPrc: "60000000000" }),
  row({ srtnCd: "100060", itmsNm: "가상통신", fltRt: "-0.5", trPrc: "70000000000" }),

  // 아래는 순위 집계에서 빠져야 하는 줄들이다.
  row({ srtnCd: "100075", itmsNm: "가상전자우", fltRt: "29.9", trPrc: "90000000000" }),
  row({ srtnCd: "10008K", itmsNm: "가상전자2우B", fltRt: "-29.9", trPrc: "90000000000" }),
  row({ srtnCd: "100090", itmsNm: "가상제1호스팩", fltRt: "29.8", trPrc: "90000000000" }),
  row({ srtnCd: "100100", itmsNm: "가상코넥스", mrktCtg: "KONEX", fltRt: "29.7", trPrc: "90000000000" }),
  row({ srtnCd: "100110", itmsNm: "가상거래정지", fltRt: "0", trqu: "0", trPrc: "0", mkp: "0", hipr: "0", lopr: "0" }),
  row({ srtnCd: "100120", itmsNm: "가상소액", fltRt: "29.6", trPrc: "900000000" }),
];

export const SAMPLE_HISTORY: RawStockPrice[] = [
  row({ basDt: "20260818", clpr: "12000", mkp: "11000", hipr: "12500", lopr: "10900", trqu: "500" }),
  row({ basDt: "20260814", clpr: "11000", mkp: "11500", hipr: "11600", lopr: "10800", trqu: "700" }),
  row({ basDt: "20260813", clpr: "11500", mkp: "11200", hipr: "11700", lopr: "11100", trqu: "600" }),
  // 다른 종목이 섞여 들어온 경우
  row({ basDt: "20260818", srtnCd: "900001", itmsNm: "다른 테스트 종목", clpr: "9000" }),
];
