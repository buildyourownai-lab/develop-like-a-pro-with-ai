import { createHash } from "node:crypto";

export function stableFscParams(params: Record<string, string | number>) {
  return Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
}

export function fscRequestKey(endpoint: string, params: Record<string, string | number>): string {
  return createHash("sha256")
    .update(`${endpoint}\n${JSON.stringify(stableFscParams(params))}`)
    .digest("hex");
}
