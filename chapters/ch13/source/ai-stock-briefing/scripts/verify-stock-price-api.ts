import { getLatestStockPrices } from "../src/lib/stock-price-api";
import { loadEnvLocal } from "./env-local";
import { redactSecret } from "../src/lib/redact";

async function main() {
  loadEnvLocal();

  console.log("금융위원회 주식시세정보 API 호출 중... (인증키 값은 출력하지 않음)");
  console.log("오늘 날짜에 데이터가 없으면 데이터가 있는 가장 최근 날짜까지 거슬러 올라갑니다.\n");

  const { basDt, totalCount, items } = await getLatestStockPrices(5);

  console.log(`데이터 기준일: ${basDt}`);
  console.log(`해당 날짜 전체 종목 수: ${totalCount}`);

  if (items.length === 0) {
    console.log("\n조회된 종목이 없습니다 (0건).");
    return;
  }

  console.log("\n종목명 | 종목코드 | 종가 | 대비 | 등락률(%) | 거래량");
  for (const it of items) {
    console.log(
      `${it.itmsNm} | ${it.srtnCd} | ${it.clpr} | ${it.vs} | ${it.fltRt} | ${it.trqu}`
    );
  }
}

main().catch((err) => {
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY ?? "";
  const message = err instanceof Error ? err.message : String(err);
  console.error("오류 발생:", redactSecret(message, serviceKey));
  process.exitCode = 1;
});
