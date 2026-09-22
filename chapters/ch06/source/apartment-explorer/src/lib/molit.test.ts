import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatAptTrade, parseAptTradeXml } from "./molit";

function fixture(name: string): string {
  const url = new URL(`./__fixtures__/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(url), "utf-8");
}

describe("parseAptTradeXml", () => {
  it("정상 응답에서 거래 목록을 파싱한다", () => {
    const records = parseAptTradeXml(fixture("molit-response-success.xml"));

    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      aptName: "테스트아파트",
      legalDong: "테스트동",
      jibun: "123-4",
      buildingDong: "101",
      floor: 15,
      exclusiveAreaSqm: 84.99,
      buildYear: 2015,
      dealDate: "2026-06-12",
      dealAmountManwon: 85000,
      isCancelled: false,
    });
  });

  it("해제여부(cdealType=O)가 있는 거래는 거래해제로 표시하고 해제일을 담는다", () => {
    const records = parseAptTradeXml(fixture("molit-response-success.xml"));
    const cancelled = records.find((r) => r.aptName === "샘플아파트");

    expect(cancelled?.isCancelled).toBe(true);
    expect(cancelled?.cancelledDate).toBe("26.07.01");
  });

  it("해제되지 않은 거래는 isCancelled가 false이고 해제일이 없다", () => {
    const records = parseAptTradeXml(fixture("molit-response-success.xml"));
    const normal = records.find((r) => r.aptName === "연습아파트");

    expect(normal?.isCancelled).toBe(false);
    expect(normal?.cancelledDate).toBeUndefined();
  });

  it("서비스키 인증 오류 응답이면 에러를 던진다", () => {
    expect(() => parseAptTradeXml(fixture("molit-response-auth-error.xml"))).toThrow(
      /SERVICE_KEY_IS_NOT_REGISTERED_ERROR/,
    );
  });

  it("해제여부 필드 자체가 없는 응답은 에러 없이 '해제 아님'으로 처리한다", () => {
    // 이 데이터셋(15126469)이 해제여부 필드를 실제로 내려주는지 문서로 확인되지 않아,
    // 필드가 없는 경우에도 안전하게 동작하는지 확인한다.
    const records = parseAptTradeXml(fixture("molit-response-success-no-cancel-field.xml"));

    expect(records).toHaveLength(1);
    expect(records[0].isCancelled).toBe(false);
    expect(records[0].cancelledDate).toBeUndefined();
  });
});

describe("formatAptTrade", () => {
  it("거래해제된 거래는 안내 문구를 포함한 사람이 읽을 수 있는 문자열을 만든다", () => {
    const records = parseAptTradeXml(fixture("molit-response-success.xml"));
    const cancelled = records.find((r) => r.aptName === "샘플아파트")!;

    expect(formatAptTrade(cancelled)).toContain("거래해제됨");
  });

  it("정상 거래는 해제 안내 문구를 포함하지 않는다", () => {
    const records = parseAptTradeXml(fixture("molit-response-success.xml"));
    const normal = records.find((r) => r.aptName === "연습아파트")!;

    expect(formatAptTrade(normal)).not.toContain("거래해제됨");
  });
});

describe("정상 응답 코드", () => {
  it('resultCode가 "000"인 응답도 정상으로 파싱한다', () => {
    const xml =
      '<?xml version="1.0" encoding="utf-8"?><response><header><resultCode>000</resultCode>' +
      "<resultMsg>OK</resultMsg></header><body><items><item><aptNm>세자리아파트</aptNm>" +
      "<umdNm>테스트동</umdNm><jibun>1-1</jibun><floor>3</floor><excluUseAr>84.99</excluUseAr>" +
      "<buildYear>2020</buildYear><dealYear>2026</dealYear><dealMonth>7</dealMonth>" +
      "<dealDay>5</dealDay><dealAmount>90,000</dealAmount></item></items>" +
      "<numOfRows>1</numOfRows><pageNo>1</pageNo><totalCount>1</totalCount></body></response>";

    const records = parseAptTradeXml(xml);

    expect(records).toHaveLength(1);
    expect(records[0].aptName).toBe("세자리아파트");
  });
});
