import { getRecentDisclosuresByStockCode } from "../src/lib/dart-disclosure-api";
import { formatYyyyMmDd, subtractDaysYyyyMmDd } from "../src/lib/trading-date";
import { loadEnvLocal } from "./env-local";
import { redactSecret } from "../src/lib/redact";

// DART 원문 뷰어는 접수번호가 잘못돼도 HTTP 200을 주지만, <title>이 "거부"로
// 온다(실제로 확인함). 그래서 링크 모양이 아니라 이 title로 실제 접근 여부를
// 확인한다.
//
// title은 OpenDART의 report_nm과 글자 하나까지 같지는 않다 — 실제로 확인한
// 두 가지 차이: "[기재정정]" 같은 맨 앞 대괄호 태그가 빠지고(rcpNo
// 20260821000615), 정기보고서의 "(1998.12)" 같은 기간 표시도 빠진다(rcpNo
// 19990331000222, report_nm "사업보고서 (1998.12)" → title "사업보고서").
// 그래서 report_nm과 완전히 같은지는 판단 기준으로 쓰지 않고, "거부"가
// 아닌지로만 실제 접근 여부를 확인한다. title은 사람이 눈으로 비교할 수
// 있게 나란히 출력한다.
async function checkDartUrlReachable(
  url: string
): Promise<{ ok: boolean; title: string }> {
  const res = await fetch(url);
  const html = await res.text();
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]?.trim() ?? "";
  const ok = res.status === 200 && title !== "거부" && title.length > 0;
  return { ok, title };
}

async function main() {
  loadEnvLocal();

  const stockCode = process.argv[2] ?? "000660"; // 기본값: SK하이닉스
  console.log(`OpenDART 공시검색 API 호출 중... (종목코드 ${stockCode}, 인증키 값은 출력하지 않음)`);

  // 종목 상세 화면의 주가 차트와 같은 최근 1년을 조회 기간으로 쓴다.
  const endDate = formatYyyyMmDd(new Date());
  const beginDate = subtractDaysYyyyMmDd(endDate, 365);
  const page = await getRecentDisclosuresByStockCode(stockCode, beginDate, endDate);

  console.log(
    `\n조회 기간 ${page.beginDate} ~ ${page.endDate} · 이 기간 전체 ${page.totalCount}건 중 최근 ${page.items.length}건`
  );
  console.log("접수일 | 보고서명(OpenDART) | 제출인 | 원문 링크 | 실제 접근 | DART 뷰어 title");
  for (const it of page.items) {
    const { ok, title } = await checkDartUrlReachable(it.dartUrl);
    console.log(
      `${it.receiptDate} | ${it.reportName} | ${it.submitter} | ${it.dartUrl} | ${ok ? "OK" : "실패(거부 또는 접근 불가)"} | ${title}`
    );
  }
}

main().catch((err) => {
  const apiKey = process.env.OPEN_DART_API_KEY ?? "";
  const message = err instanceof Error ? err.message : String(err);
  console.error("오류 발생:", redactSecret(message, apiKey));
  process.exitCode = 1;
});
