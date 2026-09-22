import { NextResponse } from "next/server";
import {
  getLatestStockPriceByCode,
  getLatestStockPrices,
  getYearlyDailyPrices,
} from "@/lib/stock-price-api";
import {
  getRecentDisclosuresByStockCode,
  getChartDisclosureMarkersByStockCode,
} from "@/lib/dart-disclosure-api";
import { formatYyyyMmDd, subtractDaysYyyyMmDd } from "@/lib/trading-date";

export const dynamic = "force-dynamic";

// 종목 상세 화면(src/app/stocks/[code]/page.tsx)과 같은 자료·같은 기간으로
// 조회한다 — 웹과 앱이 같은 의미의 값을 받아야 한다.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const chartEndDate = formatYyyyMmDd(new Date());
  const chartBeginDate = subtractDaysYyyyMmDd(chartEndDate, 365);

  let stock, market, yearly, disclosures, chartMarkers;
  try {
    [stock, market, yearly, disclosures, chartMarkers] = await Promise.all([
      getLatestStockPriceByCode(code),
      getLatestStockPrices(1),
      getYearlyDailyPrices(code),
      getRecentDisclosuresByStockCode(code, chartBeginDate, chartEndDate).then(
        (page) => ({ page }) as const,
        (err) => ({ error: err instanceof Error ? err.message : String(err) }) as const
      ),
      getChartDisclosureMarkersByStockCode(code, chartBeginDate, chartEndDate).then(
        (markers) => ({ markers }) as const,
        (err) => ({ error: err instanceof Error ? err.message : String(err) }) as const
      ),
    ]);
  } catch {
    return NextResponse.json(
      { error: "종목 정보를 가져오지 못했습니다." },
      { status: 502 }
    );
  }

  if (!stock) {
    return NextResponse.json(
      { error: "종목을 찾지 못했습니다." },
      { status: 404 }
    );
  }

  const { basDt, item } = stock;
  const price = Number(item.clpr);
  const change = Number(item.vs);
  const changeRate = Number(item.fltRt);
  // 대비(vs)·등락률(fltRt)은 전일 종가가 아니라 기준가 대비 값이다.
  // src/app/stocks/[code]/page.tsx와 같은 방식으로 종가에서 대비를 빼서 구한다.
  const basePrice = price - change;
  const open = Number(item.mkp);
  const high = Number(item.hipr);
  const low = Number(item.lopr);
  const volume = Number(item.trqu);
  const tradingValue = Number(item.trPrc);
  const baseDateDiffers = basDt !== market.basDt;

  const firstBarDate = yearly.bars[0]?.basDt;
  const earliestAcceptableStart = subtractDaysYyyyMmDd(
    yearly.requestedBeginBasDt,
    -7
  );
  const isFullYear = !!firstBarDate && firstBarDate <= earliestAcceptableStart;
  const lastBarDate = yearly.bars[yearly.bars.length - 1]?.basDt;

  return NextResponse.json({
    code: item.srtnCd,
    name: item.itmsNm,
    market: item.mrktCtg,
    basDt,
    marketBaseDate: market.basDt,
    baseDateDiffers,
    price,
    change,
    changeRate,
    basePrice,
    open,
    high,
    low,
    volume,
    tradingValue,
    chart: {
      requestedBeginDate: yearly.requestedBeginBasDt,
      isFullYear,
      firstBarDate: firstBarDate ?? null,
      lastBarDate: lastBarDate ?? null,
      bars: yearly.bars,
    },
    recentDisclosures:
      "page" in disclosures
        ? {
            beginDate: disclosures.page.beginDate,
            endDate: disclosures.page.endDate,
            totalCount: disclosures.page.totalCount,
            items: disclosures.page.items,
          }
        : { error: disclosures.error },
    chartDisclosureMarkers:
      "markers" in chartMarkers
        ? { markers: chartMarkers.markers }
        : { error: chartMarkers.error },
  });
}
