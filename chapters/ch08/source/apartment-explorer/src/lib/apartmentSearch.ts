import { fetchAptTrades, MolitApiError, type AptTradeRecord } from "./molit";
import { searchAddress, searchNearbyByCategory, searchNearbyByKeyword, KakaoApiError } from "./kakao";
import { resolveRegion } from "./region";

const SUBWAY_CATEGORY_CODE = "SW8";
const DISTANCE_NOTE =
  "지하철역·초등학교 거리는 아파트 대표 위치에서 각 장소까지의 직선거리입니다 (Kakao Local API 기준).";

export interface ApartmentSearchCriteria {
  /** 법정동/행정동 이름, 도로명주소 등 사용자가 입력한 지역 표기 */
  region: string;
  minAreaSqm: number;
  maxAreaSqm: number;
  minPriceManwon: number;
  maxPriceManwon: number;
  maxSubwayDistanceMeters: number;
  maxSchoolDistanceMeters: number;
}

export interface ApartmentComplexResult {
  aptName: string;
  legalDong: string;
  jibun: string;
  buildYear: number;
  /** 지정한 면적 범위 안의 최근 1년 정상 거래 건수 */
  tradeCountInAreaRange: number;
  /** 지정한 면적 범위 안의 최근 1년 정상 거래 가격 범위(만원) */
  priceRangeManwonInAreaRange: { min: number; max: number };
  latestTrade: { dealAmountManwon: number; dealDate: string };
  /** 지정한 면적·가격 범위를 모두 만족하는 거래 건수 */
  tradeCountInPriceRange: number;
  /** 지정한 면적 범위 안의 최근 1년 정상 거래 내역(최신순) */
  matchingTrades: AptTradeRecord[];
  nearestSubway: { name: string; distanceMeters: number };
  nearestElementarySchool: { name: string; distanceMeters: number };
  distanceNote: string;
}

/**
 * "molit" = 국토교통부 실거래가 데이터를 가져오지 못함, "kakao" = Kakao 위치 데이터를 가져오지 못함,
 * "unknown" = 그 외 예상하지 못한 서버 오류. 화면에서 세 경우를 구분해 보여주기 위한 값.
 */
export type UpstreamErrorSource = "molit" | "kakao" | "unknown";

export type ApartmentSearchOutcome =
  | { status: "ok"; resolvedRegion: string; results: ApartmentComplexResult[] }
  | { status: "no_match"; resolvedRegion: string }
  | { status: "invalid_range"; message: string }
  | { status: "region_not_found"; message: string }
  | { status: "region_ambiguous"; message: string; candidates: string[] }
  | { status: "upstream_error"; source: UpstreamErrorSource; message: string };

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 실행일 기준 최근 1년을 포함하는 계약월(YYYYMM) 목록. 월 단위 조회 후 날짜로 다시 자른다. */
function lastYearMonths(now: Date): string[] {
  const months: string[] = [];
  for (let i = 0; i <= 12; i++) {
    const d = new Date(now.getUTCFullYear(), now.getUTCMonth() - i, 1);
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

function validateCriteria(criteria: ApartmentSearchCriteria): string | null {
  if (criteria.minAreaSqm < 0 || criteria.minAreaSqm > criteria.maxAreaSqm) {
    return "전용면적 범위가 올바르지 않습니다. 최소값은 0 이상이어야 하고 최대값보다 작거나 같아야 합니다.";
  }
  if (criteria.minPriceManwon < 0 || criteria.minPriceManwon > criteria.maxPriceManwon) {
    return "실거래 가격 범위가 올바르지 않습니다. 최소값은 0 이상이어야 하고 최대값보다 작거나 같아야 합니다.";
  }
  if (criteria.maxSubwayDistanceMeters <= 0 || criteria.maxSchoolDistanceMeters <= 0) {
    return "지하철역·초등학교 거리 기준은 0보다 커야 합니다.";
  }
  return null;
}

export async function searchApartments(
  criteria: ApartmentSearchCriteria,
  now: Date = new Date(),
): Promise<ApartmentSearchOutcome> {
  const validationError = validateCriteria(criteria);
  if (validationError) {
    return { status: "invalid_range", message: validationError };
  }

  try {
    const region = await resolveRegion(criteria.region);
    if (region.status === "not_found") {
      return { status: "region_not_found", message: region.message };
    }
    if (region.status === "ambiguous") {
      return { status: "region_ambiguous", message: region.message, candidates: region.candidates };
    }

    const months = lastYearMonths(now);
    const pages = await Promise.all(
      months.map((dealYmd) => fetchAptTrades({ lawdCd: region.lawdCd, dealYmd })),
    );
    const allTrades = pages.flat();

    const oneYearAgo = new Date(now);
    oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
    const isoNow = isoDate(now);
    const isoOneYearAgo = isoDate(oneYearAgo);

    const normalTrades = allTrades.filter(
      (t) =>
        t.legalDong === region.legalDongName &&
        !t.isCancelled &&
        t.dealDate >= isoOneYearAgo &&
        t.dealDate <= isoNow,
    );

    const groups = new Map<string, AptTradeRecord[]>();
    for (const trade of normalTrades) {
      const key = `${trade.legalDong}|${trade.jibun}|${trade.aptName}`;
      const group = groups.get(key);
      if (group) {
        group.push(trade);
      } else {
        groups.set(key, [trade]);
      }
    }

    const results: ApartmentComplexResult[] = [];

    for (const trades of groups.values()) {
      const areaTrades = trades.filter(
        (t) => t.exclusiveAreaSqm >= criteria.minAreaSqm && t.exclusiveAreaSqm <= criteria.maxAreaSqm,
      );
      if (areaTrades.length === 0) continue;

      const priceTrades = areaTrades.filter(
        (t) => t.dealAmountManwon >= criteria.minPriceManwon && t.dealAmountManwon <= criteria.maxPriceManwon,
      );
      if (priceTrades.length === 0) continue;

      const sample = areaTrades[0];
      const addressQuery = `${region.sido} ${region.sigungu} ${sample.legalDong} ${sample.jibun}`;
      const addresses = await searchAddress(addressQuery);
      if (addresses.length === 0) continue;
      const coords = addresses[0].coords;

      const [subwayStations, schools] = await Promise.all([
        searchNearbyByCategory(coords, SUBWAY_CATEGORY_CODE, criteria.maxSubwayDistanceMeters, 1),
        searchNearbyByKeyword(coords, "초등학교", criteria.maxSchoolDistanceMeters, 1),
      ]);
      if (subwayStations.length === 0 || schools.length === 0) continue;

      const sortedByDateDesc = [...areaTrades].sort((a, b) => (a.dealDate < b.dealDate ? 1 : -1));
      const prices = areaTrades.map((t) => t.dealAmountManwon);

      results.push({
        aptName: sample.aptName,
        legalDong: sample.legalDong,
        jibun: sample.jibun,
        buildYear: sample.buildYear,
        tradeCountInAreaRange: areaTrades.length,
        priceRangeManwonInAreaRange: { min: Math.min(...prices), max: Math.max(...prices) },
        latestTrade: {
          dealAmountManwon: sortedByDateDesc[0].dealAmountManwon,
          dealDate: sortedByDateDesc[0].dealDate,
        },
        tradeCountInPriceRange: priceTrades.length,
        matchingTrades: sortedByDateDesc,
        nearestSubway: { name: subwayStations[0].name, distanceMeters: subwayStations[0].distanceMeters },
        nearestElementarySchool: { name: schools[0].name, distanceMeters: schools[0].distanceMeters },
        distanceNote: DISTANCE_NOTE,
      });
    }

    if (results.length === 0) {
      return { status: "no_match", resolvedRegion: region.displayName };
    }
    return { status: "ok", resolvedRegion: region.displayName, results };
  } catch (error) {
    const source: UpstreamErrorSource =
      error instanceof MolitApiError ? "molit" : error instanceof KakaoApiError ? "kakao" : "unknown";
    // 실제 원인은 서버 로그로만 남기고, 사용자에게는 개발자용 오류 메시지를 그대로 보여주지 않는다.
    console.error(`searchApartments upstream_error (source=${source}):`, error);
    const message =
      source === "molit"
        ? "국토교통부 실거래가 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요."
        : source === "kakao"
          ? "지하철역·초등학교 위치 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요."
          : "예상하지 못한 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    return { status: "upstream_error", source, message };
  }
}
