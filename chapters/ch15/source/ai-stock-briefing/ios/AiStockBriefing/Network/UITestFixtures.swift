import Foundation

enum UITestSupport {
    static let launchArgument = "-UITestFixtures"
    static func installFixturesIfNeeded() {
        guard ProcessInfo.processInfo.arguments.contains(launchArgument) else { return }
        URLProtocol.registerClass(FixtureURLProtocol.self)
    }
}

private final class FixtureURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { request.url?.path.hasPrefix("/api/") ?? false }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let url = request.url else { client?.urlProtocol(self, didFailWithError: URLError(.badURL)); return }
        let data = FixtureData.response(for: url)
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private enum FixtureData {
    static let code = "005930"; static let name = "삼성전자"; static let date = "20260904"
    static let filing = Filing(receiptNo: "20260904000001", receiptDate: date, reportName: "사업보고서", filerName: name, noteLabels: [], documentUrl: URL(string: "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260904000001")!)
    static let quote = StockQuote(baseDate: date, code: code, name: name, market: "KOSPI", close: 71500, diff: 1500, changeRate: 2.14, open: 70200, high: 71800, low: 70000, volume: 12345678, tradeValue: 883000000000)
    static func response(for url: URL) -> Data {
        switch url.path {
        case "/api/mobile/market": return encode(market())
        case "/api/mobile/stocks/search": return encode(SearchResponse(schemaVersion: "1.0", source: "data.go.kr", query: name, baseDate: date, hits: [SearchHit(code: code, name: name, market: "KOSPI", corpName: name, baseDate: date)]))
        case "/api/mobile/stocks/\(code)": return encode(stock())
        case "/api/mobile/stocks/\(code)/filings": return encode(FilingsResponse(schemaVersion: "1.0", source: "OpenDART", code: code, corpName: name, from: "20250904", to: date, filings: [filing], totalCount: 1, pageNo: 1, totalPage: 1))
        case "/api/stocks/\(code)/briefing": return encode(briefing())
        default: return #"{"error":"표본 데이터가 없습니다.","code":"NOT_FOUND","retryable":false}"#.data(using: .utf8)!
        }
    }
    static func encode<T: Encodable>(_ value: T) -> Data { try! JSONEncoder().encode(value) }
    static func market() -> MarketResponse {
        let index = IndexQuote(baseDate: date, name: "코스피", close: 2650.12, diff: 12.5, changeRate: 0.47, open: 2640, high: 2660, low: 2630, tradeValue: 1000000000000)
        return MarketResponse(schemaVersion: "1.0", source: "data.go.kr", market: MarketSnapshot(priceBaseDate: date, indexBaseDate: date, indices: [index], gainers: [quote], losers: [], universeCount: 2500, rankedCount: 100))
    }
    static func stock() -> StockResponse {
        let bars = (0..<120).map { i in DailyBar(date: String(format: "2026%02d%02d", 5 + i / 28, 1 + i % 28), open: 70000, high: 71800, low: 69800, close: 71500, volume: 10000000, tradeValue: 715000000000) }
        return StockResponse(schemaVersion: "1.0", sources: ["data.go.kr", "OpenDART"], marketBaseDate: date, quote: quote, bars: bars, filings: FilingSummary(state: "ready", corpName: name, from: "20250904", to: date, totalCount: 1, recent: [filing]))
    }
    static func briefing() -> BriefingResponse {
        let item = BriefingItem(text: "최근 종가는 71,500원입니다.", evidenceIds: ["price"])
        return BriefingResponse(packet: EvidencePacket(references: [EvidenceReference(id: "price", label: "주식시세", provider: "data.go.kr", url: URL(string: "https://www.data.go.kr")!, baseDate: date)], limits: ["미래 주가를 예측하지 않습니다."]), briefing: GroundedBriefing(headline: "공개 근거 기반 브리핑", highlights: [item], marketContext: [item], priceContext: [item], filingContext: [item], unknowns: [BriefingItem(text: "향후 실적은 알 수 없습니다.", evidenceIds: [])]), model: "fixture", generatedAt: "2026-09-06T00:00:00Z")
    }
}
