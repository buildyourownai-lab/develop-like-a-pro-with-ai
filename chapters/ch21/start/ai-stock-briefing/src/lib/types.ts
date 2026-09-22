/** 금융위원회 주식시세정보 원본 항목 */
export type RawStockPrice = {
  basDt: string;
  srtnCd: string;
  isinCd: string;
  itmsNm: string;
  mrktCtg: string;
  clpr: string;
  vs: string;
  fltRt: string;
  mkp: string;
  hipr: string;
  lopr: string;
  trqu: string;
  trPrc: string;
  lstgStCnt: string;
  mrktTotAmt: string;
};

/** 금융위원회 지수시세정보 원본 항목 */
export type RawMarketIndex = {
  basDt: string;
  idxNm: string;
  idxCsf: string;
  epyItmsCnt: string;
  clpr: string;
  vs: string;
  fltRt: string;
  mkp: string;
  hipr: string;
  lopr: string;
  trqu: string;
  trPrc: string;
};

/** 금융위원회 KRX상장종목정보 원본 항목 */
export type RawListedItem = {
  basDt: string;
  srtnCd: string;
  isinCd: string;
  mrktCtg: string;
  itmsNm: string;
  crno: string;
  corpNm: string;
};

/** 한 종목의 하루 시세 */
export type StockQuote = {
  baseDate: string;
  code: string;
  name: string;
  market: string;
  close: number;
  diff: number;
  changeRate: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  tradeValue: number;
};

/** 차트 한 칸: 하루치 시가·고가·저가·종가·거래량 */
export type DailyBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeValue: number;
};

/** 지수 하루 시세 */
export type IndexQuote = {
  baseDate: string;
  name: string;
  close: number;
  diff: number;
  changeRate: number;
  open: number;
  high: number;
  low: number;
  tradeValue: number;
};

/** 검색 결과 한 줄 */
export type SearchHit = {
  code: string;
  name: string;
  market: string;
  corpName: string;
  baseDate: string;
};

/** OpenDART 공시검색 원본 항목 */
export type RawDartFiling = {
  corp_code: string;
  corp_name: string;
  stock_code: string;
  corp_cls: string;
  report_nm: string;
  rcept_no: string;
  flr_nm: string;
  rcept_dt: string;
  rm: string;
};

/** OpenDART 고유번호 파일에서 찾은 회사 */
export type DartCorp = {
  corpCode: string;
  corpName: string;
  stockCode: string;
  modifyDate: string;
};

/** 공시 한 건. 최종 근거는 이 요약이 아니라 documentUrl의 DART 원문이다. */
export type Filing = {
  receiptNo: string;
  receiptDate: string;
  reportName: string;
  filerName: string;
  noteLabels: string[];
  documentUrl: string;
};

export type RepresentativeFiling = Filing & {
  disclosureTypeCode: "A" | "B" | "I";
  disclosureTypeLabel: string;
  selectionReason: string;
};

/** 차트의 한 거래일 자리에 놓이는 공시들. 같은 날 여러 건이 있을 수 있다. */
export type FilingMarker = {
  tradingDate: string;
  items: {
    receiptNo: string;
    receiptDate: string;
    reportName: string;
    filerName: string;
    typeLabel: string;
    documentUrl: string;
  }[];
};

/** 시장 메인 화면에 필요한 자료 묶음 */
export type MarketSnapshot = {
  priceBaseDate: string;
  indexBaseDate: string | null;
  indices: IndexQuote[];
  gainers: StockQuote[];
  losers: StockQuote[];
  universeCount: number;
  rankedCount: number;
};

export type EvidenceReference = {
  id: string;
  label: string;
  provider: string;
  url: string;
  baseDate?: string;
};

export type EvidenceObservation = {
  id: string;
  text: string;
  sourceIds: string[];
};

/** 11장에서 Gemini에 전달하는 검증 가능한 근거 묶음. Secret과 원문 본문은 포함하지 않는다. */
export type BriefingEvidencePacket = {
  schemaVersion: "2.0";
  generatedAt: string;
  market: {
    priceBaseDate: string;
    indexBaseDate: string | null;
    indices: IndexQuote[];
    gainers: StockQuote[];
    losers: StockQuote[];
  };
  stock: {
    code: string;
    name: string;
    market: string;
    quoteBaseDate: string;
    close: number;
    basePrice: number;
    diff: number;
    changeRate: number;
    open: number;
    high: number;
    low: number;
    volume: number;
    tradeValue: number;
  };
  priceHistory: {
    from: string;
    to: string;
    tradingDays: number;
    startClose: number;
    endClose: number;
    highestHigh: number;
    lowestLow: number;
    closeChange: number;
    closeChangeRate: number;
    rangePositionRate: number;
    isShortHistory: boolean;
  };
  marketComparison: {
    indexName: string;
    from: string;
    to: string;
    indexStartClose: number;
    indexEndClose: number;
    stockChangeRate: number;
    indexChangeRate: number;
    relativeChangeRate: number;
    changeRateRatio: number | null;
    latestStockChangeRate: number;
    latestIndexChangeRate: number;
    latestRelativeChangeRate: number;
    latestChangeRateRatio: number | null;
  } | null;
  filings: {
    state: "ready" | "none";
    corpName: string | null;
    from: string;
    to: string;
    totalCount: number;
    typeCounts: { code: string; label: string; count: number }[];
    representative: RepresentativeFiling[];
  };
  observations: EvidenceObservation[];
  references: EvidenceReference[];
  limits: string[];
};

export type GroundedBriefingItem = {
  text: string;
  evidenceIds: string[];
};

export type GroundedBriefing = {
  headline: string;
  highlights: GroundedBriefingItem[];
  marketContext: GroundedBriefingItem[];
  priceContext: GroundedBriefingItem[];
  filingContext: GroundedBriefingItem[];
  unknowns: GroundedBriefingItem[];
};

export type BriefingResult = {
  packet: BriefingEvidencePacket;
  briefing: GroundedBriefing;
  model: string;
  generatedAt: string;
};
