import Foundation

struct StockResponse: Codable {
    let schemaVersion: String; let sources: [String]; let marketBaseDate: String
    let quote: StockQuote; let bars: [DailyBar]; let filings: FilingSummary
}
struct DailyBar: Codable, Identifiable {
    var id: String { date }
    let date: String; let open: Double; let high: Double; let low: Double; let close: Double
    let volume: Double; let tradeValue: Double
}
