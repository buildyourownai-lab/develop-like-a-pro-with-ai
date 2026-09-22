package com.aistockbriefing.android.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable data class MarketResponse(val schemaVersion: String, val source: String, val market: MarketOverview)
@Serializable data class IndexSummary(val name: String, val baseDate: String, @SerialName("close") val value: Double, @SerialName("diff") val change: Double, val changeRate: Double, val open: Double, val high: Double, val low: Double, @SerialName("tradeValue") val tradingValue: Double)
@Serializable data class RankedStock(val name: String, val code: String, val market: String, val baseDate: String, @SerialName("close") val price: Double, @SerialName("diff") val change: Double, val changeRate: Double, val open: Double, val high: Double, val low: Double, val volume: Double, @SerialName("tradeValue") val tradingValue: Double)
@Serializable data class MarketOverview(@SerialName("priceBaseDate") val stockBaseDate: String, val indexBaseDate: String? = null, val indices: List<IndexSummary>, @SerialName("gainers") val topGainers: List<RankedStock>, @SerialName("losers") val topLosers: List<RankedStock>, @SerialName("universeCount") val totalStockCount: Int, @SerialName("rankedCount") val eligibleStockCount: Int)
@Serializable data class StockSearchResult(val code: String, val name: String, val market: String, val corpName: String, val baseDate: String)
@Serializable data class SearchResponse(val schemaVersion: String, val source: String, val query: String, val baseDate: String, @SerialName("hits") val results: List<StockSearchResult>)
