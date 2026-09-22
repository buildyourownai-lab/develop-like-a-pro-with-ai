"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatBaseDateLabel, formatChangeRate, formatTradingValue, formatVolume } from "@/lib/format";
import type { DailyPriceBar } from "@/lib/stock-price-api";

type DailyBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeValue: number;
};

type DisclosureMarker = {
  receiptNo: string;
  receiptDate: string;
  reportName: string;
  submitter: string;
  dartUrl: string;
  disclosureType?: string;
};

type FilingMarker = {
  tradingDate: string;
  items: Array<{
    receiptNo: string;
    receiptDate: string;
    reportName: string;
    filerName: string;
    typeLabel: string;
    documentUrl: string;
  }>;
};

function formatChartPrice(value: number): string {
  return Number.isInteger(value)
    ? Math.round(value).toLocaleString("ko-KR")
    : value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function formatMonthLabel(compact: string): string {
  return `${compact.slice(2, 4)}.${compact.slice(4, 6)}`;
}

function formatShortDate(compact: string): string {
  return `${compact.slice(0, 4)}.${compact.slice(4, 6)}.${compact.slice(6, 8)}`;
}

const UP = "#c62828";
const DOWN = "#1256c4";
const FLAT = "#5f6b80";
const AXIS_WIDTH = 62;
const CHART_MARGIN = { top: 8, right: 12, bottom: 0, left: 0 };

/**
 * 차트에 그리는 한 칸.
 * 캔들은 저가에서 고가까지를 쌓기 기준으로 잡고, 그 안에서 시가·종가 위치를 계산해 그린다.
 * date를 그대로 x축 값으로 쓰기 때문에 나중에 날짜를 가진 다른 자료를 같은 축에 얹을 수 있다.
 */
type ChartBar = DailyBar & {
  base: number;
  span: number;
  direction: "up" | "down" | "flat";
  /** 이 거래일 자리에 놓인 공시 건수. 0이면 표시할 것이 없다. */
  filingCount: number;
  /** 공시 띠의 높이는 건수와 무관하게 한 칸으로 고정한다. */
  filingSlot: number;
};

type CandleShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: ChartBar;
};

function Candle({ x = 0, y = 0, width = 0, height = 0, payload }: CandleShapeProps) {
  if (!payload) {
    return null;
  }
  const { open, close, high, low, direction } = payload;
  const color = direction === "up" ? UP : direction === "down" ? DOWN : FLAT;
  const span = high - low;

  // 저가~고가가 y..y+height 픽셀에 대응한다. 그 비율로 시가·종가 위치를 구한다.
  const toPixel = (price: number) => (span <= 0 ? y + height / 2 : y + ((high - price) / span) * height);

  const yOpen = toPixel(open);
  const yClose = toPixel(close);
  const bodyTop = Math.min(yOpen, yClose);
  const bodyHeight = Math.max(1, Math.abs(yClose - yOpen));
  const center = x + width / 2;
  const bodyWidth = Math.max(1, Math.min(width * 0.72, 10));

  // class 이름을 직접 달아 둔다. Recharts 내부 구조가 아니라 이 이름으로 화면을 검증한다.
  return (
    <g className="candle" data-direction={direction}>
      <line x1={center} x2={center} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={center - bodyWidth / 2} y={bodyTop} width={bodyWidth} height={bodyHeight} fill={color} />
    </g>
  );
}

/** 눈금 하나가 될 만한 값. 1·2·5 다음에 0을 붙이는 식으로 고른다. */
function niceStep(range: number): number {
  if (range <= 0) {
    return 1;
  }
  const scale = 10 ** Math.floor(Math.log10(range / 4));
  for (const unit of [1, 2, 5, 10]) {
    if (range / (unit * scale) <= 5) {
      return unit * scale;
    }
  }
  return 10 * scale;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartBar }[] }) {
  const bar = active ? payload?.[0]?.payload : undefined;
  if (!bar) {
    return null;
  }
  const rate = bar.open > 0 ? ((bar.close - bar.open) / bar.open) * 100 : 0;
  return (
    <div className="chart-tooltip">
      <div className="date">{formatShortDate(bar.date)}</div>
      <dl>
        <dt>종가</dt>
        <dd>{formatChartPrice(bar.close)}원</dd>
        <dt>시가</dt>
        <dd>{formatChartPrice(bar.open)}원</dd>
        <dt>고가</dt>
        <dd>{formatChartPrice(bar.high)}원</dd>
        <dt>저가</dt>
        <dd>{formatChartPrice(bar.low)}원</dd>
        <dt>시가 대비</dt>
        <dd>{formatChangeRate(rate)}</dd>
        <dt>거래량</dt>
        <dd>{formatVolume(bar.volume)}</dd>
        <dt>거래대금</dt>
        <dd>{formatTradingValue(bar.tradeValue)}</dd>
      </dl>
    </div>
  );
}

export function StockChart({
  bars: rawBars,
  disclosures = [],
}: {
  bars: DailyPriceBar[];
  disclosures?: DisclosureMarker[];
}) {
  const bars: DailyBar[] = useMemo(
    () =>
      rawBars.map((bar) => ({
        date: bar.basDt,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        tradeValue: bar.tradingValue,
      })),
    [rawBars]
  );
  const markers: FilingMarker[] = useMemo(() => {
    const tradingDates = bars.map((bar) => bar.date).sort();
    const grouped = new Map<string, FilingMarker["items"]>();
    for (const disclosure of [...disclosures].sort((a, b) =>
      a.receiptDate.localeCompare(b.receiptDate)
    )) {
      // 휴장일 공시는 그 뒤 첫 거래일 자리에 놓는다. 날짜를 원인처럼
      // 바꾸는 것이 아니라, 거래일 축에서 확인 가능한 다음 칸에 묶는 규칙이다.
      const tradingDate = tradingDates.find((date) => date >= disclosure.receiptDate);
      if (!tradingDate) continue;
      const items = grouped.get(tradingDate) ?? [];
      items.push({
        receiptNo: disclosure.receiptNo,
        receiptDate: disclosure.receiptDate,
        reportName: disclosure.reportName,
        filerName: disclosure.submitter,
        typeLabel:
          disclosure.disclosureType === "A"
            ? "정기공시"
            : disclosure.disclosureType === "B"
              ? "주요사항보고"
              : "공시",
        documentUrl: disclosure.dartUrl,
      });
      grouped.set(tradingDate, items);
    }
    return [...grouped].map(([tradingDate, items]) => ({ tradingDate, items }));
  }, [bars, disclosures]);
  const [mode, setMode] = useState<"candle" | "close">("candle");
  const [pickedDate, setPickedDate] = useState<string | null>(null);

  const markerByDate = useMemo(
    () => new Map(markers.map((marker) => [marker.tradingDate, marker])),
    [markers]
  );

  const data = useMemo<ChartBar[]>(
    () =>
      bars.map((bar) => ({
        ...bar,
        base: bar.low,
        span: Math.max(bar.high - bar.low, 0),
        direction: bar.close > bar.open ? "up" : bar.close < bar.open ? "down" : "flat",
        filingCount: markerByDate.get(bar.date)?.items.length ?? 0,
        filingSlot: markerByDate.has(bar.date) ? 1 : 0,
      })),
    [bars, markerByDate]
  );

  const picked = pickedDate ? markerByDate.get(pickedDate) : undefined;

  /** 242개 날짜를 다 쓰면 축이 읽히지 않는다. 달이 바뀌는 첫 거래일만 눈금으로 쓴다. */
  const monthTicks = useMemo(() => {
    const ticks: string[] = [];
    let lastMonth = "";
    for (const bar of data) {
      const month = bar.date.slice(0, 6);
      if (month !== lastMonth) {
        ticks.push(bar.date);
        lastMonth = month;
      }
    }
    return ticks;
  }, [data]);

  /**
   * y축 눈금을 49,080원처럼 어정쩡한 숫자로 두면 읽히지 않는다.
   * 저가~고가에 여유를 준 뒤, 그 폭에 맞는 단위로 아래는 내리고 위는 올려 딱 떨어지게 만든다.
   */
  const priceDomain = useMemo<[number, number]>(() => {
    if (data.length === 0) {
      return [0, 1];
    }
    const low = Math.min(...data.map((bar) => bar.low));
    const high = Math.max(...data.map((bar) => bar.high));
    const pad = Math.max((high - low) * 0.06, high * 0.01);
    const step = niceStep(high + pad - Math.max(0, low - pad));
    return [Math.max(0, Math.floor((low - pad) / step) * step), Math.ceil((high + pad) / step) * step];
  }, [data]);

  if (data.length === 0) {
    return (
      <p className="notice">
        <strong>차트를 그릴 자료가 없습니다</strong>
        이 종목은 최근 1년 구간에 제공된 일별 시세가 없습니다.
      </p>
    );
  }

  return (
    <div>
      <div className="chart-toggle" style={{ marginBottom: 10 }}>
        <button type="button" aria-pressed={mode === "candle"} onClick={() => setMode("candle")}>
          일봉
        </button>
        <button type="button" aria-pressed={mode === "close"} onClick={() => setMode("close")}>
          종가 선
        </button>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid stroke="#eef1f6" vertical={false} />
          <XAxis
            dataKey="date"
            ticks={monthTicks}
            tickFormatter={formatMonthLabel}
            tick={{ fontSize: 11, fill: "#8b95a6" }}
            tickLine={false}
            axisLine={{ stroke: "#e3e8f0" }}
          />
          <YAxis
            domain={priceDomain}
            width={AXIS_WIDTH}
            allowDataOverflow
            tickFormatter={(value: number) => formatChartPrice(value)}
            tick={{ fontSize: 11, fill: "#8b95a6" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<ChartTooltip />} />
          {/*
            Recharts는 자기가 아는 자식 요소를 직접 찾는다.
            조건부로 <>...</> 조각으로 묶으면 Bar를 못 찾아 아무것도 그리지 않는다.
            그래서 각 요소를 개별 자식으로 둔다.
            저가 아래쪽은 투명하게 깔고, 그 위에 저가~고가 구간을 캔들로 그린다.
          */}
          {mode === "candle" && (
            <Bar dataKey="base" stackId="candle" fill="transparent" isAnimationActive={false} />
          )}
          {mode === "candle" && (
            <Bar dataKey="span" stackId="candle" shape={<Candle />} isAnimationActive={false} />
          )}
          {mode === "close" && (
            <Line
              type="linear"
              dataKey="close"
              stroke="#1c48b8"
              strokeWidth={1.6}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {markers.length > 0 && (
        <div className="filing-band" data-testid="filing-band">
          <p className="chart-label">공시 시점</p>
          {/*
            공시는 캔들 위에 그리지 않는다. 같은 시간축을 쓰는 얇은 띠를 따로 두고 그 위에만 표시한다.
            그래서 가격 흐름이 가려지지 않는다.
          */}
          <ResponsiveContainer width="100%" height={44}>
            <BarChart data={data} margin={CHART_MARGIN} barCategoryGap={0}>
              <XAxis dataKey="date" ticks={monthTicks} tick={false} tickLine={false} axisLine={false} height={1} />
              <YAxis domain={[0, 1]} width={AXIS_WIDTH} tick={false} tickLine={false} axisLine={false} />
              <Bar
                dataKey="filingSlot"
                isAnimationActive={false}
                shape={<FilingTick />}
                onClick={(entry: unknown) => {
                  const date = (entry as { payload?: ChartBar } | undefined)?.payload?.date;
                  if (date && markerByDate.has(date)) {
                    setPickedDate((current) => (current === date ? null : date));
                  }
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {picked && (
        <div className="filing-picked" data-testid="filing-picked">
          <div className="filing-picked-head">
            <strong>{formatBaseDateLabel(picked.tradingDate)} 자리의 공시 {picked.items.length}건</strong>
            <button type="button" onClick={() => setPickedDate(null)}>
              닫기
            </button>
          </div>
          <ul>
            {picked.items.map((item) => (
              <li key={item.receiptNo}>
                <span className="filing-meta">
                  접수 {formatShortDate(item.receiptDate)} · {item.typeLabel} · 제출인 {item.filerName}
                </span>
                <a href={item.documentUrl} target="_blank" rel="noreferrer noopener">
                  {item.reportName} <span aria-hidden="true">↗</span>
                  <span className="visually-hidden">DART 원문 새 창에서 열기</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="chart-label">거래량</p>
      <ResponsiveContainer width="100%" height={110}>
        <BarChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid stroke="#eef1f6" vertical={false} />
          <XAxis
            dataKey="date"
            ticks={monthTicks}
            tickFormatter={formatMonthLabel}
            tick={{ fontSize: 11, fill: "#8b95a6" }}
            tickLine={false}
            axisLine={{ stroke: "#e3e8f0" }}
          />
          <YAxis
            width={AXIS_WIDTH}
            tickFormatter={(value: number) => formatVolume(value)}
            tick={{ fontSize: 11, fill: "#8b95a6" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="volume" isAnimationActive={false} shape={<VolumeBar />} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * 공시가 있는 거래일 자리에만 작은 표식을 찍는다.
 * 건수가 여러 건이면 표식 아래에 건수를 적는다. 그 날의 목록은 눌러서 확인한다.
 */
function FilingTick({ x = 0, width = 0, payload }: CandleShapeProps) {
  if (!payload || payload.filingCount === 0) {
    return null;
  }
  const center = x + width / 2;
  return (
    <g className="filing-marker" data-count={payload.filingCount} style={{ cursor: "pointer" }}>
      <rect x={center - 10} y={0} width={20} height={40} fill="transparent" />
      <line
        x1={center}
        x2={center}
        y1={12}
        y2={30}
        stroke="#c7aee2"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <circle cx={center} cy={12} r={5} fill="#7a3fb8" stroke="#fff" strokeWidth={2} />
      {payload.filingCount > 1 && (
        <text x={center} y={40} textAnchor="middle" fontSize={9} fill="#7a3fb8">
          {payload.filingCount}
        </text>
      )}
    </g>
  );
}

function VolumeBar({ x = 0, y = 0, width = 0, height = 0, payload }: CandleShapeProps) {
  if (!payload) {
    return null;
  }
  const color = payload.direction === "up" ? UP : payload.direction === "down" ? DOWN : FLAT;
  const barWidth = Math.max(1, Math.min(width * 0.72, 10));
  return (
    <rect
      className="volume-bar"
      x={x + width / 2 - barWidth / 2}
      y={y}
      width={barWidth}
      height={Math.max(0, height)}
      fill={color}
    />
  );
}
