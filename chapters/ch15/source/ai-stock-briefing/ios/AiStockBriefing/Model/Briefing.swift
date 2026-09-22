import Foundation

struct BriefingResponse: Codable { let packet: EvidencePacket; let briefing: GroundedBriefing; let model: String; let generatedAt: String }
struct EvidencePacket: Codable { let references: [EvidenceReference]; let limits: [String] }
struct EvidenceReference: Codable, Identifiable {
    let id: String; let label: String; let provider: String; let url: URL; let baseDate: String?
}
struct GroundedBriefing: Codable {
    let headline: String; let highlights: [BriefingItem]; let marketContext: [BriefingItem]
    let priceContext: [BriefingItem]; let filingContext: [BriefingItem]; let unknowns: [BriefingItem]
}
struct BriefingItem: Codable, Identifiable {
    var id: String { evidenceIds.joined(separator: "|") + text }
    let text: String; let evidenceIds: [String]
}
struct APIErrorBody: Codable { let error: String; let code: String?; let retryable: Bool? }
