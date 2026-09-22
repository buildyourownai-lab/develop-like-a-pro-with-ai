import { mkdir, writeFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

import { corpMapFromXml } from "../src/lib/filings";

async function main() {
  const apiKey = process.env.OPEN_DART_API_KEY?.trim();
  if (!apiKey) throw new Error("OPEN_DART_API_KEY가 필요합니다.");

  const url = new URL("https://opendart.fss.or.kr/api/corpCode.xml");
  url.searchParams.set("crtfc_key", apiKey);
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`OpenDART 고유번호 파일을 받지 못했습니다. (HTTP ${response.status})`);

  const zip = Buffer.from(await response.arrayBuffer());
  if (zip.readUInt32LE(0) !== 0x04034b50) throw new Error("OpenDART 고유번호 파일이 zip 형식이 아닙니다.");
  const nameLength = zip.readUInt16LE(26);
  const extraLength = zip.readUInt16LE(28);
  const xml = inflateRawSync(zip.subarray(30 + nameLength + extraLength)).toString("utf8");
  const rows = [...corpMapFromXml(xml).values()].sort((a, b) => a.stockCode.localeCompare(b.stockCode));
  if (rows.length === 0) throw new Error("OpenDART 고유번호 파일에서 상장회사를 찾지 못했습니다.");

  await mkdir(new URL("../src/data/", import.meta.url), { recursive: true });
  await writeFile(
    new URL("../src/data/dart-corp-map.json", import.meta.url),
    `${JSON.stringify(rows, null, 2)}\n`,
    "utf8"
  );
  console.log(`OpenDART 상장회사 ${rows.length}건을 갱신했습니다.`);
}

void main();
