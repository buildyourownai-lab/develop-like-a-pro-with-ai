package com.aistockbriefing.android.network

import com.aistockbriefing.android.model.BriefingResponse
import com.aistockbriefing.android.model.DisclosuresResponse
import com.aistockbriefing.android.model.MarketOverview
import com.aistockbriefing.android.model.MarketResponse
import com.aistockbriefing.android.model.SearchResponse
import com.aistockbriefing.android.model.StockDetail

// 화면에서 쓸 자료를 서버(JSON API)에서만 받아온다. 시세·공시·AI 브리핑을
// 이 앱이 직접 계산하지 않고, 이미 확인·검증까지 마친 서버의 결과만 그대로
// 보여준다.
object StockRepository {

    suspend fun getMarket(): MarketOverview {
        val url = ApiClient.urlBuilder("api", "mobile", "market").build()
        return ApiClient.decodeOrThrow<MarketResponse>(ApiClient.get(url)).market
    }

    suspend fun search(query: String): SearchResponse {
        val url = ApiClient.urlBuilder("api", "mobile", "stocks", "search")
            .addQueryParameter("q", query)
            .build()
        return ApiClient.decodeOrThrow(ApiClient.get(url))
    }

    suspend fun getStockDetail(code: String): StockDetail {
        val url = ApiClient.urlBuilder("api", "mobile", "stocks", code).build()
        return ApiClient.decodeOrThrow(ApiClient.get(url))
    }

    suspend fun getDisclosures(
        code: String,
        page: Int,
    ): DisclosuresResponse {
        val builder = ApiClient.urlBuilder("api", "mobile", "stocks", code, "filings")
            .addQueryParameter("page", page.toString())
        return ApiClient.decodeOrThrow(ApiClient.get(builder.build()))
    }

    suspend fun postBriefing(code: String): BriefingResponse {
        val url = ApiClient.urlBuilder("api", "stocks", code, "briefing").build()
        return ApiClient.decodeOrThrow(ApiClient.post(url))
    }
}
