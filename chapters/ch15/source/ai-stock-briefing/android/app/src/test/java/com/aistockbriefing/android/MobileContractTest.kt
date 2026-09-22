package com.aistockbriefing.android

import com.aistockbriefing.android.model.MarketResponse
import com.aistockbriefing.android.model.BriefingResponse
import com.aistockbriefing.android.model.DisclosuresResponse
import com.aistockbriefing.android.model.SearchResponse
import com.aistockbriefing.android.model.StockDetail
import com.aistockbriefing.android.network.ApiClient
import com.aistockbriefing.android.network.ApiException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileContractTest {
    @Test fun decodesProductionMarketEnvelope() {
        val value = ApiClient.decodeOrThrow<MarketResponse>(
            """{"schemaVersion":"1.0","source":"FSC","market":{"priceBaseDate":"20260828","indexBaseDate":"20260828","indices":[{"baseDate":"20260828","name":"코스피","close":6789.0,"diff":-12.0,"changeRate":-1.79,"open":6800.0,"high":6810.0,"low":6770.0,"tradeValue":1.0}],"gainers":[],"losers":[],"universeCount":2500,"rankedCount":100}}"""
        )
        assertEquals("20260828", value.market.stockBaseDate)
        assertEquals(6789.0, value.market.indices.single().value, 0.0)
    }

    @Test fun decodesProductionSearchHits() {
        val value = ApiClient.decodeOrThrow<SearchResponse>(
            """{"schemaVersion":"1.0","source":"KRX","query":"하이닉스","baseDate":"20260828","hits":[{"code":"000660","name":"SK하이닉스","market":"KOSPI","corpName":"에스케이하이닉스","baseDate":"20260828"}]}"""
        )
        assertEquals("000660", value.results.single().code)
    }

    @Test fun decodesProductionStockAndFilings() {
        val value = ApiClient.decodeOrThrow<StockDetail>(
            """{"schemaVersion":"1.0","sources":["FSC","DART"],"marketBaseDate":"20260828","quote":{"baseDate":"20260828","code":"000660","name":"SK하이닉스","market":"KOSPI","close":1653000,"diff":-77000,"changeRate":-4.45,"open":1704000,"high":1725000,"low":1653000,"volume":3531892,"tradeValue":1},"bars":[{"date":"20260828","open":1704000,"high":1725000,"low":1653000,"close":1653000,"volume":3531892,"tradeValue":1}],"filings":{"state":"ready","corpName":"SK하이닉스","from":"20250828","to":"20260828","totalCount":1,"recent":[{"receiptNo":"1","receiptDate":"20260828","reportName":"보고서","filerName":"SK하이닉스","noteLabels":[],"documentUrl":"https://dart.fss.or.kr/x"}]}}"""
        )
        assertEquals(1653000.0, value.quote.close, 0.0)
        assertEquals("https://dart.fss.or.kr/x", value.filings.recent.single().dartUrl)
    }

    @Test fun errorEnvelopeWithMetadataThrows() {
        val thrown = runCatching { ApiClient.decodeOrThrow<SearchResponse>("""{"error":"다시 시도해 주세요.","code":"UPSTREAM_FAILURE","retryable":true}""") }.exceptionOrNull()
        assertTrue(thrown is ApiException)
        assertEquals("다시 시도해 주세요.", thrown?.message)
    }

    @Test fun decodesProductionPaginatedFilings() {
        val value = ApiClient.decodeOrThrow<DisclosuresResponse>(
            """{"schemaVersion":"1.0","source":"OpenDART","code":"000660","corpName":"SK하이닉스","from":"20250828","to":"20260828","pageNo":1,"totalCount":21,"totalPage":2,"filings":[{"receiptNo":"1","receiptDate":"20260828","reportName":"보고서","filerName":"SK하이닉스","noteLabels":[],"documentUrl":"https://dart.fss.or.kr/x"}]}"""
        )
        assertEquals(2, value.totalPage)
        assertEquals(1, value.items.size)
    }

    @Test fun decodesStructuredBriefingSuccess() {
        val value = ApiClient.decodeOrThrow<BriefingResponse>(
            """{"packet":{"schemaVersion":"2.0","generatedAt":"2026-08-28T00:00:00Z","market":{},"stock":{},"priceHistory":{},"marketComparison":null,"filings":{},"observations":[],"references":[{"id":"stock","label":"시세","provider":"금융위원회","url":"https://example.com","baseDate":"20260828"}],"limits":["미래 가격은 알 수 없습니다."]},"briefing":{"headline":"근거 기반 브리핑","highlights":[{"text":"현재가를 확인했습니다.","evidenceIds":["stock"]}],"marketContext":[],"priceContext":[],"filingContext":[],"unknowns":[{"text":"미래 가격은 알 수 없습니다.","evidenceIds":["stock"]}]},"model":"gemini","generatedAt":"2026-08-28T00:00:00Z"}"""
        )
        assertEquals("근거 기반 브리핑", value.briefing.headline)
        assertEquals(2, value.briefing.allItems.size)
        assertEquals(1, value.packet.references.size)
    }
}
