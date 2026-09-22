import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { ENV_KEYS, type EnvKey } from "@/lib/secret-fields";

const ENV_LOCAL_PATH = path.join(process.cwd(), ".env.local");

function quoteEnvValue(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function findKeyLineIndex(lines: string[], key: EnvKey): number {
  const pattern = new RegExp(`^\\s*${key}\\s*=`);
  return lines.findIndex((line) => pattern.test(line));
}

async function readEnvLocalLines(): Promise<string[]> {
  try {
    const text = await fs.readFile(ENV_LOCAL_PATH, "utf8");
    return text.split(/\r?\n/);
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

// 빈 값으로 온 항목은 건드리지 않아, 그 항목의 기존 값이 그대로 남는다.
export async function upsertEnvLocalValues(
  updates: Partial<Record<EnvKey, string>>
): Promise<void> {
  const entries = Object.entries(updates).filter(
    ([, value]) => value !== undefined && value.trim() !== ""
  ) as [EnvKey, string][];

  if (entries.length === 0) {
    return;
  }

  const lines = await readEnvLocalLines();

  for (const [key, value] of entries) {
    const line = `${key}=${quoteEnvValue(value.trim())}`;
    const index = findKeyLineIndex(lines, key);
    if (index === -1) {
      lines.push(line);
    } else {
      lines[index] = line;
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const fileContent = lines.join("\n") + "\n";
  await fs.writeFile(ENV_LOCAL_PATH, fileContent, { mode: 0o600 });
  await fs.chmod(ENV_LOCAL_PATH, 0o600);
}

// 값 자체는 절대 돌려주지 않고, 이미 채워져 있는지 여부만 알려준다.
export async function getEnvLocalStatus(): Promise<Record<EnvKey, boolean>> {
  const lines = await readEnvLocalLines();
  const status = {} as Record<EnvKey, boolean>;

  for (const key of ENV_KEYS) {
    const index = findKeyLineIndex(lines, key);
    if (index === -1) {
      status[key] = false;
      continue;
    }
    const rawValue = lines[index].slice(lines[index].indexOf("=") + 1).trim();
    const unquoted = rawValue.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    status[key] = unquoted.length > 0;
  }

  return status;
}
