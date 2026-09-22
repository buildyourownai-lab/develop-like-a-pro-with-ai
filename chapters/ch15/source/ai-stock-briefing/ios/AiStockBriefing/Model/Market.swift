import Foundation

struct MarketResponse: Codable { let schemaVersion: String; let source: String; let market: MarketSnapshot }
struct MarketSnapshot: Codable {
    let priceBaseDate: String; let indexBaseDate: String?; let indices: [IndexQuote]
    let gainers: [StockQuote]; let losers: [StockQuote]; let universeCount: Int; let rankedCount: Int
}
struct IndexQuote: Codable, Identifiable {
    var id: String { name }
    let baseDate: String; let name: String; let close: Double; let diff: Double; let changeRate: Double
    let open: Double; let high: Double; let low: Double; let tradeValue: Double
}
struct StockQuote: Codable, Identifiable {
    var id: String { code }
    let baseDate: String; let code: String; let name: String; let market: String; let close: Double
    let diff: Double; let changeRate: Double; let open: Double; let high: Double; let low: Double
    let volume: Double; let tradeValue: Double
}
struct SearchResponse: Codable {
    let schemaVersion: String; let source: String; let query: String; let baseDate: String; let hits: [SearchHit]
}
struct SearchHit: Codable, Identifiable {
    var id: String { code }
    let code: String; let name: String; let market: String; let corpName: String; let baseDate: String
}
