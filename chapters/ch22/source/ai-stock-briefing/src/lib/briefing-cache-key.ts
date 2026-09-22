import { createHash } from "node:crypto";

import type { BriefingEvidencePacket } from "./types";

export const BRIEFING_PROMPT_VERSION = "chapter11-grounded-v5-reader-first";
export const BRIEFING_CACHE_TTL_SECONDS = 60 * 60;

function canonicalEvidence(packet: BriefingEvidencePacket) {
  return { ...packet, generatedAt: undefined };
}

export function briefingCacheKey(packet: BriefingEvidencePacket, model: string, namespace: string) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        promptVersion: BRIEFING_PROMPT_VERSION,
        model,
        evidence: canonicalEvidence(packet),
      })
    )
    .digest("hex");
  return `chapter12:${namespace}:briefing:${digest}`;
}
