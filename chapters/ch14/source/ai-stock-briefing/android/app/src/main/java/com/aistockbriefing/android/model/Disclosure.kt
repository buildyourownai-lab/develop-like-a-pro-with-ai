package com.aistockbriefing.android.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable data class DisclosureItem(val receiptNo: String, val receiptDate: String, val reportName: String, @SerialName("filerName") val submitter: String, val noteLabels: List<String> = emptyList(), @SerialName("documentUrl") val dartUrl: String)
@Serializable data class DisclosuresResponse(val schemaVersion: String, val source: String, val code: String, val corpName: String, val from: String, val to: String, val pageNo: Int, val totalCount: Int, val totalPage: Int, @SerialName("filings") val items: List<DisclosureItem>)
