import fs from "node:fs";
import path from "node:path";
import { generateStockBriefingAction } from "../src/app/stocks/[code]/briefing-actions";

function loadEnvLocal(): void {
  const content = fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  loadEnvLocal();
  const result = await generateStockBriefingAction(process.argv[2] ?? "000660");
  if ("error" in result) throw new Error(result.error);

  const { facts, packet } = result;
  console.log("Gemini 입력 자료 검증 (실제 API, 인증키 값은 출력하지 않음)");
  console.log(`종목 | ${facts.stock.baseDate} ${facts.stock.name}(${facts.stock.code}) · ${facts.stock.market} · 종가 ${facts.stock.price}원 · 등락률 ${facts.stock.changeRate}%`);
  for (const market of facts.marketComparison) {
    console.log(`시장 | ${market.indexBaseDate} ${market.indexName} ${market.indexChangeRate}% · 종목과 차이 ${market.deltaPp}%p`);
  }
  console.log(`가격 | ${facts.priceFlow.periodStartDate} ~ ${facts.priceFlow.periodEndDate} · 거래일 ${facts.priceFlow.tradingDayCount}일 · 변동률 ${facts.priceFlow.periodChangeRate}%`);
  console.log(`공시 | ${facts.disclosures.beginDate} ~ ${facts.disclosures.endDate} · 전체 ${facts.disclosures.totalCount}건 · 대표 ${facts.disclosures.representative?.length ?? 0}건`);
  console.log("출처");
  for (const reference of packet.references) {
    console.log(`- ${reference.id} | ${reference.label} | ${reference.url}`);
  }
  console.log(`Gemini에 전달하는 근거 관측 ${packet.observations.length}개 · 출처 ${packet.references.length}개`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
