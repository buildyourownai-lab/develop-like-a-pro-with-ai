import Foundation

public struct MarketResponse: Codable, Sendable {
    public let schemaVersion: String
    public let source: String
    public let market: MarketSnapshot
}
public struct MarketSnapshot: Codable, Sendable {
    public let priceBaseDate: String
    public let indexBaseDate: String?
    public let indices: [IndexQuote]
    public let gainers: [StockQuote]
    public let losers: [StockQuote]
    public let universeCount: Int
    public let rankedCount: Int
}

public struct IndexQuote: Codable, Identifiable, Sendable {
    public var id: String { name }
    public let baseDate: String
    public let name: String
    public let close: Double
    public let diff: Double
    public let changeRate: Double
    public let open: Double
    public let high: Double
    public let low: Double
    public let tradeValue: Double
}

public struct StockQuote: Codable, Identifiable, Sendable {
    public var id: String { code }
    public let baseDate: String
    public let code: String
    public let name: String
    public let market: String
    public let close: Double
    public let diff: Double
    public let changeRate: Double
    public let open: Double
    public let high: Double
    public let low: Double
    public let volume: Double
    public let tradeValue: Double
}

public struct SearchResponse: Codable, Sendable {
    public let schemaVersion: String
    public let source: String
    public let query: String
    public let baseDate: String
    public let hits: [SearchHit]
}

public struct SearchHit: Codable, Identifiable, Sendable {
    public var id: String { code }
    public let code: String
    public let name: String
    public let market: String
    public let corpName: String
    public let baseDate: String
}

public struct StockResponse: Codable, Sendable {
    public let schemaVersion: String
    public let sources: [String]
    public let marketBaseDate: String
    public let quote: StockQuote
    public let bars: [DailyBar]
    public let filings: FilingSummary
}

public struct DailyBar: Codable, Identifiable, Sendable {
    public var id: String { date }
    public let date: String
    public let open: Double
    public let high: Double
    public let low: Double
    public let close: Double
    public let volume: Double
    public let tradeValue: Double
}

public struct FilingSummary: Codable, Sendable {
    public let state: String
    public let corpName: String?
    public let from: String?
    public let to: String?
    public let totalCount: Int
    public let recent: [Filing]
}

public struct Filing: Codable, Identifiable, Sendable {
    public var id: String { receiptNo }
    public let receiptNo: String
    public let receiptDate: String
    public let reportName: String
    public let filerName: String
    public let noteLabels: [String]
    public let documentUrl: URL
}

public struct BriefingResponse: Codable, Sendable {
    public let packet: EvidencePacket
    public let briefing: GroundedBriefing
    public let model: String
    public let generatedAt: String
}

public struct EvidencePacket: Codable, Sendable {
    public let references: [EvidenceReference]
    public let limits: [String]
}

public struct EvidenceReference: Codable, Identifiable, Sendable {
    public let id: String
    public let label: String
    public let provider: String
    public let url: URL
    public let baseDate: String?
}

public struct GroundedBriefing: Codable, Sendable {
    public let headline: String
    public let highlights: [BriefingItem]
    public let marketContext: [BriefingItem]
    public let priceContext: [BriefingItem]
    public let filingContext: [BriefingItem]
    public let unknowns: [BriefingItem]

    public var allItems: [BriefingItem] {
        var seen = Set<String>()
        let periodComparisonIsHighlighted = highlights.contains {
            $0.evidenceIds.contains("MARKET_COMPARISON_PERIOD")
        }
        return (highlights + marketContext + priceContext + filingContext + unknowns).filter { item in
            if periodComparisonIsHighlighted && item.evidenceIds.contains("PRICE_PERIOD") {
                return false
            }
            return seen.insert(item.text.trimmingCharacters(in: .whitespacesAndNewlines)).inserted
        }
    }
}

public struct BriefingItem: Codable, Identifiable, Sendable {
    public var id: String { evidenceIds.joined(separator: "|") + text }
    public let text: String
    public let evidenceIds: [String]
}

public struct APIErrorBody: Codable, Sendable {
    public let error: String
    public let code: String?
    public let retryable: Bool?
}
