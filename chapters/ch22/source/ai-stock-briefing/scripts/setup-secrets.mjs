import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(projectDir, ".env.local");
const csrfToken = randomBytes(24).toString("hex");

const fields = [
  {
    name: "DATA_GO_KR_SERVICE_KEY",
    label: "공공데이터포털 Service Key",
    help: "금융위원회 주식·지수·상장종목 API. 이미 있으면 비워 두세요.",
    href: "https://www.data.go.kr/",
  },
  {
    name: "OPEN_DART_API_KEY",
    label: "OpenDART 인증키",
    help: "기업 고유번호와 공시 조회용. 이미 있으면 비워 두세요.",
    href: "https://opendart.fss.or.kr/",
  },
  {
    name: "GEMINI_API_KEY",
    label: "Gemini API Key",
    help: "근거 기반 AI 브리핑 생성용입니다.",
    href: "https://aistudio.google.com/apikey",
  },
  {
    name: "SUPABASE_URL",
    label: "Supabase Project URL",
    help: "Project Settings에서 확인하는 https://…supabase.co 주소입니다.",
    href: "https://supabase.com/dashboard",
  },
  {
    name: "SUPABASE_SECRET_KEY",
    label: "Supabase Secret Key",
    help: "sb_secret_… 형식의 서버 전용 키입니다. publishable/anon 키가 아닙니다.",
    href: "https://supabase.com/docs/guides/api/api-keys",
  },
  {
    name: "SUPABASE_DATABASE_URL",
    label: "Supabase Database URL",
    help: "Connect 창의 transaction pooler 연결 문자열입니다. 스키마 준비에 사용합니다.",
    href: "https://supabase.com/docs/guides/database/connecting-to-postgres",
  },
  {
    name: "UPSTASH_REDIS_REST_URL",
    label: "Upstash Redis REST URL",
    help: "Redis Database Details에 표시되는 REST URL입니다.",
    href: "https://console.upstash.com/",
  },
  {
    name: "UPSTASH_REDIS_REST_TOKEN",
    label: "Upstash Redis REST Token",
    help: "같은 화면의 서버 전용 REST Token입니다.",
    href: "https://upstash.com/docs/redis/howto/connectwithupstashredis",
  },
];

function parsePresentKeys(source) {
  const present = new Set();
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match && match[2].trim() !== "") present.add(match[1]);
  }
  return present;
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function quoteEnv(value) {
  if (/[\r\n\0]/.test(value)) throw new Error("환경변수 값에는 줄바꿈을 넣을 수 없습니다.");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$")}"`;
}

function updateEnv(source, updates) {
  const lines = source === "" ? [] : source.replace(/\n$/, "").split("\n");
  const remaining = new Map(updates);
  const next = lines.map((line) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!match || !remaining.has(match[1])) return line;
    const value = remaining.get(match[1]);
    remaining.delete(match[1]);
    return `${match[1]}=${quoteEnv(value)}`;
  });
  for (const [name, value] of remaining) next.push(`${name}=${quoteEnv(value)}`);
  return `${next.join("\n")}\n`;
}

function page(present, message = "") {
  const inputs = fields.map((field) => {
    const saved = present.has(field.name);
    return `<label class="field">
      <span class="title">${escapeHtml(field.label)} ${saved ? '<b class="saved">저장됨</b>' : '<b class="missing">미입력</b>'}</span>
      <input type="password" name="${field.name}" autocomplete="off" placeholder="${saved ? "비워 두면 기존 값을 보존합니다" : "여기에 직접 입력하세요"}">
      <small>${escapeHtml(field.help)} <a href="${field.href}" target="_blank" rel="noreferrer">공식 페이지</a></small>
    </label>`;
  }).join("");

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>12장 PoC Secret 준비</title><style>
  :root{color-scheme:light;--ink:#17202a;--muted:#627080;--line:#dce2e8;--accent:#2457d6;--ok:#167447;--warn:#a44b00}*{box-sizing:border-box}
  body{margin:0;background:#f4f6f9;color:var(--ink);font-family:system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif}main{max-width:780px;margin:36px auto;padding:0 20px 60px}
  .card{background:white;border:1px solid var(--line);border-radius:18px;padding:28px;box-shadow:0 8px 30px #15223810}h1{font-size:26px;margin:0 0 10px}p{color:var(--muted);line-height:1.6}.notice{background:#eef4ff;border-radius:10px;padding:12px 14px;color:#29466e}.field{display:block;margin-top:22px}.title{display:flex;align-items:center;gap:8px;font-weight:750}.saved,.missing{font-size:12px;padding:3px 7px;border-radius:999px}.saved{background:#e8f7ef;color:var(--ok)}.missing{background:#fff0e6;color:var(--warn)}
  input{width:100%;margin-top:8px;padding:13px;border:1px solid #b9c3ce;border-radius:9px;font:inherit}input:focus{outline:3px solid #2457d622;border-color:var(--accent)}small{display:block;margin-top:6px;color:var(--muted);line-height:1.5}a{color:var(--accent)}button{width:100%;margin-top:28px;padding:14px;border:0;border-radius:10px;background:var(--accent);color:white;font-size:16px;font-weight:800;cursor:pointer}.message{color:var(--ok);font-weight:800}
  </style></head><body><main><section class="card"><h1>12장 PoC Secret 준비</h1>
  <p class="notice">이 페이지는 내 컴퓨터의 <strong>127.0.0.1</strong>에서만 열립니다. 값은 채팅이나 브라우저 로그로 보내지 않고, Git에서 제외된 <strong>.env.local</strong>에 저장합니다.</p>
  ${message ? `<p class="message">${escapeHtml(message)}</p>` : ""}<form method="post" action="/save"><input type="hidden" name="csrf" value="${csrfToken}">${inputs}<button type="submit">입력한 값 안전하게 저장</button></form>
  </section></main></body></html>`;
}

async function readEnv() {
  try { return await readFile(envPath, "utf8"); } catch (error) { if (error?.code === "ENOENT") return ""; throw error; }
}

async function protectExistingEnv() {
  try { await chmod(envPath, 0o600); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

const server = createServer(async (request, response) => {
  try {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'");
    if (request.method === "GET" && request.url === "/") {
      const source = await readEnv();
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(page(parsePresentKeys(source)));
      return;
    }
    if (request.method !== "POST" || request.url !== "/save") {
      response.writeHead(404).end("Not found");
      return;
    }
    const expectedOrigin = `http://127.0.0.1:${server.address().port}`;
    if (request.headers.origin !== expectedOrigin) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 65_536) throw new Error("입력값이 너무 큽니다.");
    }
    const form = new URLSearchParams(body);
    if (form.get("csrf") !== csrfToken) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const updates = fields.flatMap(({ name }) => {
      const value = form.get(name)?.trim() ?? "";
      return value === "" ? [] : [[name, value]];
    });
    const source = await readEnv();
    if (updates.length > 0) {
      const tempPath = `${envPath}.tmp-${process.pid}`;
      await writeFile(tempPath, updateEnv(source, updates), { mode: 0o600 });
      await rename(tempPath, envPath);
      await chmod(envPath, 0o600);
    }
    const savedSource = await readEnv();
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(page(parsePresentKeys(savedSource), updates.length > 0 ? "저장했습니다. 이 창을 닫아도 됩니다." : "새로 입력한 값이 없어 기존 설정을 그대로 보존했습니다."));
  } catch (error) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : "저장하지 못했습니다.");
  }
});

await protectExistingEnv();

server.listen(0, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`Secret 입력창: ${url}`);
  if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
});
