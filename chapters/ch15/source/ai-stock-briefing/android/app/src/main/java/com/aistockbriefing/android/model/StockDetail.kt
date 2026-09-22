package com.aistockbriefing.android.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable data class DailyBar(@SerialName("date") val basDt: String, val open: Double, val high: Double, val low: Double, val close: Double, val volume: Double, @SerialName("tradeValue") val tradingValue: Double)
@Serializable data class StockQuote(val baseDate: String, val code: String, val name: String, val market: String, val close: Double, val diff: Double, val changeRate: Double, val open: Double, val high: Double, val low: Double, val volume: Double, val tradeValue: Double)
@Serializable data class FilingSummary(val state: String, val corpName: String? = null, val from: String? = null, val to: String? = null, val totalCount: Int, val recent: List<DisclosureItem>)
@Serializable data class StockDetail(val schemaVersion: String, val sources: List<String>, val marketBaseDate: String, val quote: StockQuote, val bars: List<DailyBar>, val filings: FilingSummary)
