package com.aistockbriefing.android.model

import kotlinx.serialization.Serializable

@Serializable data class BriefingItem(val text: String, val evidenceIds: List<String>)
@Serializable data class GroundedBriefing(val headline: String, val highlights: List<BriefingItem>, val marketContext: List<BriefingItem>, val priceContext: List<BriefingItem>, val filingContext: List<BriefingItem>, val unknowns: List<BriefingItem>) { val allItems get() = highlights + marketContext + priceContext + filingContext + unknowns }
@Serializable data class EvidenceReference(val id: String, val label: String, val provider: String, val url: String, val baseDate: String? = null)
@Serializable data class EvidencePacket(val references: List<EvidenceReference>, val limits: List<String>)
@Serializable data class BriefingResponse(val packet: EvidencePacket, val briefing: GroundedBriefing, val model: String, val generatedAt: String)
