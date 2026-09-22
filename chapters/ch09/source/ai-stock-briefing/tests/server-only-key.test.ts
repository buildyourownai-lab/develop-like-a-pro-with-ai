import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function readEnvLocalValue(key: string): string {
  const envPath = path.join(projectRoot, ".env.local");
  const content = fs.readFileSync(envPath, "utf8");
  const line = content.split("\n").find((l) => l.startsWith(`${key}=`));
  if (!line) {
    throw new Error(`${key} 값을 .env.local에서 찾지 못했습니다.`);
  }
  return line.slice(key.length + 1).trim();
}

function collectClientBundleFiles(): string[] {
  const staticDir = path.join(projectRoot, ".next", "static");
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) files.push(full);
    }
  }
  walk(staticDir);
  return files;
}

describe("인증키가 브라우저로 내려가지 않는다", () => {
  it("서버 전용 모듈에는 server-only 가드가 있다", () => {
    for (const file of ["server-env.ts", "fsc-api.ts"]) {
      const src = fs.readFileSync(
        path.join(projectRoot, "src", "lib", file),
        "utf8"
      );
      expect(src.startsWith('import "server-only"')).toBe(true);
    }
  });

  it("빌드된 클라이언트 자바스크립트에 인증키 값이 포함되지 않는다", () => {
    const key = readEnvLocalValue("DATA_GO_KR_SERVICE_KEY");
    expect(key.length).toBeGreaterThan(0);

    const files = collectClientBundleFiles();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content.includes(key)).toBe(false);
    }
  });

  it("빌드된 클라이언트 자바스크립트에 인증키 변수 이름도 노출되지 않는다", () => {
    const files = collectClientBundleFiles();
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      expect(content.includes("DATA_GO_KR_SERVICE_KEY")).toBe(false);
    }
  });
});
