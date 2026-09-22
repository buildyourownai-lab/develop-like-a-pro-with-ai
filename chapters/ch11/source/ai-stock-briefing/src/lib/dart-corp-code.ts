import "server-only";
import zlib from "node:zlib";
import { getOpenDartApiKey } from "./server-env";

const CORP_CODE_ENDPOINT = "https://opendart.fss.or.kr/api/corpCode.xml";

// 프로세스 안에서 한 번만 내려받아 재사용한다. OpenDART corpCode.xml은 상장
// 여부와 무관하게 전체 회사 목록(수만 건)을 담고 있어 매 요청마다 새로 받기엔
// 무겁고, 목록 자체도 자주 바뀌지 않는다.
let corpCodeByStockCodeCache: Promise<Map<string, string>> | null = null;

function findCentralDirectoryOffset(buf: Buffer): number {
  const EOCD_SIGNATURE = 0x06054b50;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      return buf.readUInt32LE(i + 16);
    }
  }
  throw new Error("corpCode.zip에서 ZIP 구조(EOCD)를 찾지 못했습니다.");
}

// OpenDART corpCode.xml은 zip 하나에 CORPCODE.xml 파일 하나만 담아 온다.
// 그 한 항목의 압축 방식과 위치만 중앙 디렉터리에서 읽으면 되므로, 별도
// zip 라이브러리 없이 Node 내장 zlib(inflateRaw)로 직접 압축을 푼다.
function unzipSingleEntry(buf: Buffer): Buffer {
  const cdOffset = findCentralDirectoryOffset(buf);
  const CENTRAL_DIR_SIGNATURE = 0x02014b50;
  if (buf.readUInt32LE(cdOffset) !== CENTRAL_DIR_SIGNATURE) {
    throw new Error("corpCode.zip의 중앙 디렉터리 레코드를 찾지 못했습니다.");
  }

  const compressionMethod = buf.readUInt16LE(cdOffset + 10);
  const compressedSize = buf.readUInt32LE(cdOffset + 20);
  const localHeaderOffset = buf.readUInt32LE(cdOffset + 42);

  const LOCAL_FILE_SIGNATURE = 0x04034b50;
  if (buf.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error("corpCode.zip의 로컬 파일 헤더를 찾지 못했습니다.");
  }
  const fileNameLen = buf.readUInt16LE(localHeaderOffset + 26);
  const extraLen = buf.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLen + extraLen;
  const compressed = buf.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) return Buffer.from(compressed);
  if (compressionMethod === 8) return zlib.inflateRawSync(compressed);
  throw new Error(
    `corpCode.zip이 지원하지 않는 압축 방식을 씁니다 (method ${compressionMethod}).`
  );
}

// 비상장·상장폐지 회사는 stock_code가 빈 칸(공백 8자)으로 온다. trim 후
// 빈 문자열이면 매핑에서 뺀다 — 종목코드로 찾을 대상이 아니기 때문이다.
function parseStockCodeToCorpCode(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const listRe = /<list>([\s\S]*?)<\/list>/g;
  let match: RegExpExecArray | null;
  while ((match = listRe.exec(xml))) {
    const block = match[1];
    const corpCode = /<corp_code>(.*?)<\/corp_code>/.exec(block)?.[1];
    const stockCode = /<stock_code>(.*?)<\/stock_code>/
      .exec(block)?.[1]
      ?.trim();
    if (corpCode && stockCode) map.set(stockCode, corpCode);
  }
  return map;
}

async function loadCorpCodeByStockCode(): Promise<Map<string, string>> {
  const apiKey = getOpenDartApiKey();
  const res = await fetch(
    `${CORP_CODE_ENDPOINT}?${new URLSearchParams({ crtfc_key: apiKey })}`
  );
  const buf = Buffer.from(await res.arrayBuffer());

  // 인증키가 잘못됐거나 호출에 실패하면 zip이 아니라 JSON 오류를 준다.
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    const json = JSON.parse(buf.toString("utf8")) as {
      status?: string;
      message?: string;
    };
    throw new Error(
      `OpenDART corpCode 조회 실패: ${json.status} ${json.message ?? ""}`
    );
  }

  const xml = unzipSingleEntry(buf).toString("utf8");
  return parseStockCodeToCorpCode(xml);
}

export async function findCorpCodeByStockCode(
  stockCode: string
): Promise<string | null> {
  if (!corpCodeByStockCodeCache) {
    corpCodeByStockCodeCache = loadCorpCodeByStockCode().catch((err) => {
      corpCodeByStockCodeCache = null;
      throw err;
    });
  }
  const map = await corpCodeByStockCodeCache;
  return map.get(stockCode) ?? null;
}
