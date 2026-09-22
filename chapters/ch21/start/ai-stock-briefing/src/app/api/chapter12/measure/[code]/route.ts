import { NextResponse } from "next/server";

import { collectBriefingEvidence } from "@/lib/briefing-evidence";
import { Chapter12MeasuredError, withChapter12Metrics } from "@/lib/chapter12-metrics";
import { readGeminiModel } from "@/lib/env";
import { createGroundedBriefing } from "@/lib/gemini";
import { getMarketSnapshot } from "@/lib/market";
import { readCachedBriefing } from "@/lib/redis-briefing-cache";
import { fetchStockHistory, isValidCode, normalizeCode } from "@/lib/stock";
import type { BriefingEvidencePacket } from "@/lib/types";

export const runtime = "nodejs";

type MeasureBody = {
  profile?: "baseline" | "after";
  experiment?: "database" | "cache" | "service";
  namespace?: string;
  redisTtlSeconds?: number;
  databaseTtlSeconds?: number;
  cacheProbeOnly?: boolean;
  prepareEvidence?: boolean;
  evidence?: BriefingEvidencePacket;
};

const preparedEvidence = new Map<string, BriefingEvidencePacket>();

function authorized(request: Request): boolean {
  const expected = process.env.CHAPTER12_MEASUREMENT_TOKEN?.trim();
  return Boolean(expected && request.headers.get("x-chapter12-measurement-token") === expected);
}

function safeTtl(value: number | undefined): number | undefined {
  return Number.isInteger(value) && value! >= 1 && value! <= 86_400 ? value : undefined;
}

function diagnostic(error: unknown): string[] {
  const messages: string[] = [];
  let current = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    messages.push(
      `${current.name}: ${current.message}`
        .replace(/\b(?:postgres(?:ql)?|rediss?):\/\/[^\s|]+/gi, "[redacted-connection-url]")
        .replace(/\bhttps?:\/\/[^\s|]*[?&](?:key|token|serviceKey)=[^&\s|]+/gi, "[redacted-url]")
        .replace(/authorization\s*[:=]\s*[^\s|]+/gi, "authorization=[redacted]")
        .replace(/key=[^&\s]+/gi, "key=[redacted]")
        .replace(/AIza[A-Za-z0-9_-]+/g, "[redacted]")
    );
    current = current.cause;
  }
  return messages;
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!authorized(request)) return new NextResponse(null, { status: 404 });
  const body = (await request.json()) as MeasureBody;
  const profile = body.profile === "after" ? "after" : "baseline";
  const experiment = body.experiment ?? "service";
  const namespace = /^[a-z0-9-]{1,80}$/.test(body.namespace ?? "") ? body.namespace! : "chapter12-measurement";
  try {
    const measured = await withChapter12Metrics(
      {
        databaseEnabled: experiment !== "cache" && profile === "after",
        redisEnabled: experiment !== "database" && profile === "after",
        bypassNextCache: true,
        namespace,
        redisTtlSeconds: safeTtl(body.redisTtlSeconds),
        databaseTtlSeconds: safeTtl(body.databaseTtlSeconds),
      },
      async () => {
        const code = normalizeCode(decodeURIComponent((await params).code).toUpperCase());
        if (!isValidCode(code)) throw new Error("여섯 자리 종목코드가 필요합니다.");

        if (experiment === "database") {
          const market = await getMarketSnapshot();
          const { quote, bars } = await fetchStockHistory(code, market.priceBaseDate);
          return {
            code,
            quoteBaseDate: quote?.baseDate ?? null,
            priceRows: bars.length,
            marketRows: market.universeCount,
          };
        }

        if (experiment === "cache" && body.prepareEvidence) {
          const packet = await collectBriefingEvidence(code);
          preparedEvidence.set(namespace, packet);
          return {
            prepared: true,
            model: readGeminiModel(),
            evidence: {
              generatedAt: packet.generatedAt,
              stockCode: packet.stock.code,
              stockQuoteBaseDate: packet.stock.quoteBaseDate,
              marketPriceBaseDate: packet.market.priceBaseDate,
              marketIndexBaseDate: packet.market.indexBaseDate,
              filingFrom: packet.filings.from,
              filingTo: packet.filings.to,
            },
            packet,
          };
        }

        const packet =
          experiment === "cache"
            ? body.evidence?.schemaVersion === "2.0" && body.evidence.stock.code === code
              ? body.evidence
              : preparedEvidence.get(namespace)
            : await collectBriefingEvidence(code);
        if (!packet) throw new Error("Cache 실험용 Evidence를 먼저 준비해야 합니다.");
        if (body.cacheProbeOnly) {
          const cached = await readCachedBriefing(packet, readGeminiModel());
          return { cacheState: cached ? "hit" : "miss" };
        }
        return createGroundedBriefing(packet);
      }
    );
    return NextResponse.json({
      ...measured,
      runtime: {
        vercelRegion: process.env.VERCEL_REGION ?? null,
        vercelDeploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      },
    });
  } catch (caught) {
    const measuredError = caught instanceof Chapter12MeasuredError ? caught : null;
    const diagnosticTarget = measuredError?.cause ?? caught;
    return NextResponse.json(
      {
        error: diagnosticTarget instanceof Error ? diagnosticTarget.message : "측정에 실패했습니다.",
        diagnostic: diagnostic(diagnosticTarget),
        metrics: measuredError?.metrics ?? null,
        runtime: {
          vercelRegion: process.env.VERCEL_REGION ?? null,
          vercelDeploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
        },
      },
      { status: 500 }
    );
  }
}
