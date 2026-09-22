import "server-only";

import { summarizeMarketComparison, summarizePriceHistory } from "./briefing-facts";
import { fetchFilingsByTypes, fetchFilingTypeCounts, findCorpByStockCode } from "./dart";
import {
  BRIEFING_FILING_RULE_TEXT,
  BRIEFING_FILING_TYPES,
  selectRepresentativeFilings,
} from "./filings";
import { directionLabel, directionOf, formatPrice, formatSignedRate } from "./format";
import { fetchIndexHistory, getMarketSnapshot } from "./market";
import { fetchStockHistory, isValidCode, normalizeCode } from "./stock";
import { formatShortDate, seoulToday } from "./trading-date";
import type {
  BriefingEvidencePacket,
  DailyBar,
  MarketSnapshot,
  StockQuote,
} from "./types";

export class InsufficientEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientEvidenceError";
  }
}

type FilingEvidence = BriefingEvidencePacket["filings"];

function formatAbsoluteRate(value: number): string {
  return `${Math.abs(value).toFixed(2)}%`;
}

function movementVerb(value: number): string {
  if (value > 0) return "올랐습니다";
  if (value < 0) return "떨어졌습니다";
  return "변동이 없었습니다";
}

function topicSubject(subject: string): string {
  const lastCode = subject.charCodeAt(subject.length - 1);
  const hasFinalConsonant = lastCode >= 0xac00 && lastCode <= 0xd7a3
    ? (lastCode - 0xac00) % 28 !== 0
    : false;
  return `${subject}${hasFinalConsonant ? "은" : "는"}`;
}

function comparisonSentence(input: {
  subject: string;
  indexName: string;
  stockRate: number;
  indexRate: number;
  ratio: number | null;
  period: string;
  periodStyle?: boolean;
}): string {
  const { subject, indexName, stockRate, indexRate, ratio, period, periodStyle = false } = input;
  const stockDirection = directionOf(stockRate);
  const indexDirection = directionOf(indexRate);
  const topic = topicSubject(subject);
  if (stockDirection === "flat") {
    return `${period} ${topic} 보합이었고, ${indexName}은 ${formatAbsoluteRate(indexRate)} ${directionLabel(indexDirection)}했습니다.`;
  }
  if (indexDirection === "flat") {
    return `${period} ${topic} ${formatAbsoluteRate(stockRate)} ${directionLabel(stockDirection)}했지만, ${indexName}은 보합이어서 배수로 비교하지 않았습니다.`;
  }
  if (stockDirection !== indexDirection || ratio === null) {
    return `${period} ${topic} ${formatAbsoluteRate(stockRate)} ${directionLabel(stockDirection)}했지만, ${indexName}은 ${formatAbsoluteRate(indexRate)} ${directionLabel(indexDirection)}해 움직인 방향이 달랐습니다.`;
  }
  const rateLabel = stockDirection === "up" ? "상승률" : "하락률";
  if (periodStyle) {
    return `${period} ${topic} ${formatAbsoluteRate(stockRate)} ${directionLabel(stockDirection)}해, ${rateLabel}이 ${indexName}(${formatAbsoluteRate(indexRate)})의 약 ${ratio.toFixed(1)}배였습니다.`;
  }
  const scale = ratio >= 1
    ? `${indexName} ${rateLabel} ${formatAbsoluteRate(indexRate)}보다 약 ${ratio.toFixed(1)}배 큰 폭으로`
    : `${indexName} ${rateLabel} ${formatAbsoluteRate(indexRate)}의 약 ${ratio.toFixed(1)}배 수준으로`;
  return `${period} ${topic} ${formatAbsoluteRate(stockRate)} ${directionLabel(stockDirection)}해, ${scale} ${movementVerb(stockRate)}.`;
}

function formatKoreanMonthDay(date: string): string {
  return `${Number(date.slice(4, 6))}월 ${Number(date.slice(6, 8))}일`;
}

function buildObservations(
  market: MarketSnapshot,
  quote: StockQuote,
  history: BriefingEvidencePacket["priceHistory"],
  marketComparison: BriefingEvidencePacket["marketComparison"],
  filings: FilingEvidence
): BriefingEvidencePacket["observations"] {
  const indexSnapshot = market.indices.length > 0
    ? market.indices
        .map((index) => `${index.name} ${formatPrice(index.close)} (${formatSignedRate(index.changeRate)})`)
        .join(", ")
    : "제공된 시장 지수 없음";
  const observations: BriefingEvidencePacket["observations"] = [
    {
      id: "MARKET_BASE_DATE",
      text: `시장 종목 자료 기준일은 ${formatShortDate(market.priceBaseDate)}이고 지수 자료 기준일은 ${market.indexBaseDate ? formatShortDate(market.indexBaseDate) : "제공되지 않았다"}.`,
      sourceIds: ["FSC_STOCK", "FSC_INDEX"],
    },
    {
      id: "MARKET_SNAPSHOT",
      text: `지수 자료 기준일의 시장 지수는 ${indexSnapshot}이다.`,
      sourceIds: ["FSC_STOCK", "FSC_INDEX"],
    },
    {
      id: "STOCK_QUOTE",
      text: `${formatShortDate(quote.baseDate)} ${quote.name}(${quote.code}) 종가는 ${formatPrice(quote.close)}원이며 전일 대비 ${formatAbsoluteRate(quote.changeRate)} ${directionLabel(directionOf(quote.changeRate))}했다.`,
      sourceIds: ["FSC_STOCK"],
    },
    {
      id: "PRICE_PERIOD",
      text: `${formatShortDate(history.from)}부터 ${formatShortDate(history.to)}까지 종가는 ${formatPrice(history.startClose)}원에서 ${formatPrice(history.endClose)}원으로 바뀌어 ${formatAbsoluteRate(history.closeChangeRate)} ${directionLabel(directionOf(history.closeChangeRate))}했다.`,
      sourceIds: ["FSC_STOCK"],
    },
    {
      id: "PRICE_RANGE",
      text: `같은 기간의 장중 최고가는 ${formatPrice(history.highestHigh)}원이고 장중 최저가는 ${formatPrice(history.lowestLow)}원이다.`,
      sourceIds: ["FSC_STOCK"],
    },
    ...(marketComparison
      ? [
          {
            id: "MARKET_COMPARISON_LATEST",
            text: comparisonSentence({
              subject: quote.name,
              indexName: marketComparison.indexName,
              stockRate: marketComparison.latestStockChangeRate,
              indexRate: marketComparison.latestIndexChangeRate,
              ratio: marketComparison.latestChangeRateRatio,
              period: formatShortDate(quote.baseDate),
            }),
            sourceIds: ["FSC_STOCK", "FSC_INDEX"],
          },
          {
            id: "MARKET_COMPARISON_PERIOD",
            text: comparisonSentence({
              subject: quote.name,
              indexName: marketComparison.indexName,
              stockRate: marketComparison.stockChangeRate,
              indexRate: marketComparison.indexChangeRate,
              ratio: marketComparison.changeRateRatio,
              period: history.isShortHistory
                ? `${formatShortDate(marketComparison.from)}부터 ${formatShortDate(marketComparison.to)}까지`
                : "최근 1년간",
              periodStyle: true,
            }),
            sourceIds: ["FSC_STOCK", "FSC_INDEX"],
          },
        ]
      : []),
    {
      id: "FILING_PERIOD",
      text:
        filings.state === "ready"
          ? `${formatShortDate(filings.from)}부터 ${formatShortDate(filings.to)}까지 OpenDART 공시 ${filings.totalCount.toLocaleString("ko-KR")}건이 접수됐다.`
          : "연결할 상장회사 고유번호가 없어 이 종목의 공시 근거는 제공하지 않는다.",
      sourceIds: filings.state === "ready" ? ["OPEN_DART"] : ["LIMITS"],
    },
    {
      id: "FILING_SELECTION_RULE",
      text:
        filings.state === "ready" && filings.representative.length > 0
          ? BRIEFING_FILING_RULE_TEXT
          : "현재 근거 묶음에는 읽어 설명할 대표 공시 메타정보가 없다.",
      sourceIds: filings.state === "ready" ? ["OPEN_DART"] : ["LIMITS"],
    },
  ];
  if (filings.state === "ready") {
    observations.push(
      ...filings.representative.map((filing) => ({
        id: `FILING_${filing.receiptNo}`,
        text: `${formatKoreanMonthDay(filing.receiptDate)} — ${filing.reportName} · ${filing.disclosureTypeLabel}. 공시 제목과 접수 정보이며 자세한 내용은 DART 원문 ${filing.documentUrl}에서 확인한다.`,
        sourceIds: ["OPEN_DART"],
      }))
    );
  }
  return observations;
}

/** 순수 계산 부분을 분리해 숫자와 근거 연결을 실제 API 없이도 검사한다. */
export function buildEvidencePacket(input: {
  market: MarketSnapshot;
  quote: StockQuote;
  bars: DailyBar[];
  indexHistory?: MarketSnapshot["indices"];
  filings: FilingEvidence;
  generatedAt?: string;
}): BriefingEvidencePacket {
  const history = summarizePriceHistory(input.bars);
  const marketComparison = summarizeMarketComparison(input.quote, history, input.indexHistory ?? []);
  const basePrice = input.quote.close - input.quote.diff;

  return {
    schemaVersion: "2.0",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    market: {
      priceBaseDate: input.market.priceBaseDate,
      indexBaseDate: input.market.indexBaseDate,
      indices: input.market.indices,
      gainers: input.market.gainers,
      losers: input.market.losers,
    },
    stock: {
      code: input.quote.code,
      name: input.quote.name,
      market: input.quote.market,
      quoteBaseDate: input.quote.baseDate,
      close: input.quote.close,
      basePrice,
      diff: input.quote.diff,
      changeRate: input.quote.changeRate,
      open: input.quote.open,
      high: input.quote.high,
      low: input.quote.low,
      volume: input.quote.volume,
      tradeValue: input.quote.tradeValue,
    },
    priceHistory: history,
    marketComparison,
    filings: input.filings,
    observations: buildObservations(input.market, input.quote, history, marketComparison, input.filings),
    references: [
      {
        id: "FSC_STOCK",
        label: "금융위원회 주식시세정보",
        provider: "공공데이터포털",
        url: "https://www.data.go.kr/data/15094808/openapi.do",
        baseDate: input.quote.baseDate,
      },
      {
        id: "FSC_INDEX",
        label: "금융위원회 지수시세정보",
        provider: "공공데이터포털",
        url: "https://www.data.go.kr/data/15094809/openapi.do",
        baseDate: input.market.indexBaseDate ?? undefined,
      },
      {
        id: "OPEN_DART",
        label: "OpenDART 공시검색",
        provider: "금융감독원 전자공시시스템",
        url: "https://opendart.fss.or.kr/",
      },
    ],
    limits: [
      "이 근거만으로 공시와 가격 움직임의 인과관계를 알 수 없다.",
      "이 근거는 미래 가격, 목표주가, 매수·매도 판단을 제공하지 않는다.",
      "공시 메타정보만으로 공시 본문 전체의 의미를 확정할 수 없다. 최종 확인은 DART 원문에서 한다.",
    ],
  };
}

async function loadFilingEvidence(code: string, from: string): Promise<FilingEvidence> {
  const corp = await findCorpByStockCode(code);
  const to = seoulToday();
  if (!corp) {
    return { state: "none", corpName: null, from, to, totalCount: 0, typeCounts: [], representative: [] };
  }

  const [typedFilings, typeCounts] = await Promise.all([
    fetchFilingsByTypes({ corpCode: corp.corpCode, from, to, typeCodes: [...BRIEFING_FILING_TYPES] }),
    fetchFilingTypeCounts({ corpCode: corp.corpCode, from, to }),
  ]);
  return {
    state: "ready",
    corpName: corp.corpName,
    from,
    to,
    totalCount: typeCounts.reduce((sum, entry) => sum + entry.count, 0),
    typeCounts,
    representative: selectRepresentativeFilings(typedFilings),
  };
}

/** 9·10장의 공식 데이터 함수를 그대로 재사용해 11장용 근거를 만든다. */
export async function collectBriefingEvidence(rawCode: string): Promise<BriefingEvidencePacket> {
  const code = normalizeCode(rawCode.toUpperCase());
  if (!isValidCode(code)) {
    throw new InsufficientEvidenceError("여섯 자리 종목코드가 필요합니다.");
  }

  const market = await getMarketSnapshot();
  const { quote, bars } = await fetchStockHistory(code, market.priceBaseDate);
  if (!quote || bars.length === 0) {
    throw new InsufficientEvidenceError("브리핑에 필요한 종목 가격 자료가 없습니다.");
  }
  const indexName = quote.market === "KOSDAQ" ? "코스닥" : "코스피";
  const [filings, indexHistory] = await Promise.all([
    loadFilingEvidence(code, bars[0].date),
    fetchIndexHistory(indexName, bars[0].date, bars[bars.length - 1].date),
  ]);
  return buildEvidencePacket({ market, quote, bars, indexHistory, filings });
}
