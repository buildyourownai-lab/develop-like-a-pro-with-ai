import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";

const apiKey = process.env.OPEN_DART_API_KEY?.trim();
assert.ok(apiKey, "OPEN_DART_API_KEY가 필요합니다.");

const BASE = "https://opendart.fss.or.kr/api";
const CORP_CODE = "00164779";
const FROM = "20250819";
const TO = "20260819";
const EXPECTED_FIELDS = [
  "corp_cls",
  "corp_code",
  "corp_name",
  "flr_nm",
  "rcept_dt",
  "rcept_no",
  "report_nm",
  "rm",
  "stock_code",
];

type RawFiling = Record<string, string>;
type Payload = {
  status: string;
  message: string;
  page_no?: number;
  page_count?: number;
  total_count?: number;
  total_page?: number;
  list?: RawFiling[];
};

async function list(params: Record<string, string | number>): Promise<Payload> {
  const query = new URLSearchParams({ crtfc_key: apiKey! });
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  const response = await fetch(`${BASE}/list.json?${query}`, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200);
  return (await response.json()) as Payload;
}

async function main() {
const common = { corp_code: CORP_CODE, bgn_de: FROM, end_de: TO };
const first = await list({ ...common, page_no: 1, page_count: 100 });
assert.equal(first.status, "000");
assert.equal(first.page_no, 1);
assert.equal(first.page_count, 100);
assert.ok((first.total_count ?? 0) > 100);
assert.ok((first.total_page ?? 0) > 1);
assert.equal(first.list?.length, 100);
assert.deepEqual(Object.keys(first.list![0]).sort(), EXPECTED_FIELDS);
assert.equal(first.list![0].corp_code, CORP_CODE);
assert.equal(first.list![0].corp_name, "SK하이닉스");
assert.equal(first.list![0].stock_code, "000660");
assert.ok(first.list!.some((filing) => filing.report_nm !== filing.report_nm.trim()));

const dates = new Map<string, number>();
for (const filing of first.list!) dates.set(filing.rcept_dt, (dates.get(filing.rcept_dt) ?? 0) + 1);
assert.ok([...dates.values()].some((count) => count > 1), "동일 접수일 복수 공시가 있어야 합니다.");

const second = await list({ ...common, page_no: 2, page_count: 100 });
assert.equal(second.status, "000");
assert.equal(second.page_no, 2);
assert.equal(second.total_count, first.total_count);
const firstReceipts = new Set(first.list!.map((filing) => filing.rcept_no));
assert.ok(second.list!.every((filing) => !firstReceipts.has(filing.rcept_no)));

const typeCodes = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
const typeCounts = await Promise.all(
  typeCodes.map(async (typeCode) => {
    const payload = await list({ ...common, page_no: 1, page_count: 1, pblntf_ty: typeCode });
    assert.ok(["000", "013"].includes(payload.status));
    return { typeCode, count: Number(payload.total_count ?? 0) };
  })
);
assert.equal(typeCounts.reduce((sum, entry) => sum + entry.count, 0), first.total_count);
assert.ok(typeCounts.find((entry) => entry.typeCode === "D")!.count > 100);

const noData = await list({ corp_code: CORP_CODE, bgn_de: "19900101", end_de: "19900102", page_no: 1, page_count: 100 });
assert.equal(noData.status, "013");
assert.equal(Number(noData.total_count ?? 0), 0);

const corpResponse = await fetch(`${BASE}/corpCode.xml?crtfc_key=${encodeURIComponent(apiKey!)}`, {
  signal: AbortSignal.timeout(60_000),
});
assert.equal(corpResponse.status, 200);
const zip = Buffer.from(await corpResponse.arrayBuffer());
assert.equal(zip.readUInt32LE(0), 0x04034b50);
const nameLength = zip.readUInt16LE(26);
const extraLength = zip.readUInt16LE(28);
const xml = inflateRawSync(zip.subarray(30 + nameLength + extraLength)).toString("utf8");
const entries = [...xml.matchAll(/<list>([\s\S]*?)<\/list>/g)].map((match) => match[1]);
const field = (entry: string, name: string) =>
  new RegExp(`<${name}>([^<]*)<\\/${name}>`).exec(entry)?.[1] ?? "";
const listed = entries.filter((entry) => /^\d{6}$/.test(field(entry, "stock_code")));
const hynix = listed.find((entry) => field(entry, "stock_code") === "000660");
assert.ok(hynix);
assert.equal(field(hynix!, "corp_code"), CORP_CODE);
assert.equal(field(hynix!, "corp_name"), "SK하이닉스");

const receiptNo = first.list![0].rcept_no;
const documentResponse = await fetch(`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receiptNo}`, {
  redirect: "follow",
  signal: AbortSignal.timeout(30_000),
});
assert.equal(documentResponse.status, 200);
assert.doesNotMatch(JSON.stringify({ first: first.list![0], typeCounts }), new RegExp(apiKey!, "g"));

console.log(
  JSON.stringify({
    corp: { stockCode: "000660", corpCode: CORP_CODE, corpName: "SK하이닉스" },
    corpCodeRows: entries.length,
    listedCorpRows: listed.length,
    totalCount: first.total_count,
    totalPage: first.total_page,
    typeCounts,
    sameDateCount: [...dates.values()].filter((count) => count > 1).length,
    noDataStatus: noData.status,
    documentStatus: documentResponse.status,
    responseFields: EXPECTED_FIELDS,
  })
);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "10장 실제 API 검증 실패");
  process.exitCode = 1;
});
