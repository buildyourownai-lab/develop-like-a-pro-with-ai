import Foundation
import Testing
@testable import StockBriefingCore

@Suite("iPhone 공통 API 모델")
struct CoreTests {
    @Test func searchEndpointEncodesKoreanQuery() throws {
        let base = try #require(URL(string: "http://127.0.0.1:3000"))
        let url = try APIEndpoint.search("SK하이닉스").url(relativeTo: base)
        #expect(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first?.value == "SK하이닉스")
    }

    @Test func marketResponseDecodes() throws {
        let data = Data(#"{"schemaVersion":"1.0","source":"금융위원회","market":{"priceBaseDate":"20260820","indexBaseDate":"20260820","indices":[],"gainers":[],"losers":[],"universeCount":1,"rankedCount":1}}"#.utf8)
        let response = try JSONDecoder().decode(MarketResponse.self, from: data)
        #expect(response.market.priceBaseDate == "20260820")
    }

    @Test func briefingKeepsEvidenceAndUnknowns() throws {
        let data = Data(#"{"packet":{"references":[{"id":"price","label":"시세","provider":"금융위원회","url":"https://example.com","baseDate":"20260820"}],"limits":["미래 가격은 알 수 없습니다."]},"briefing":{"headline":"근거 기반 브리핑","highlights":[],"marketContext":[],"priceContext":[],"filingContext":[],"unknowns":[{"text":"미래 가격은 알 수 없습니다.","evidenceIds":[]}]},"model":"gemini","generatedAt":"2026-08-21T00:00:00Z"}"#.utf8)
        let response = try JSONDecoder().decode(BriefingResponse.self, from: data)
        #expect(response.packet.references.count == 1)
        #expect(response.briefing.unknowns.count == 1)
    }

    @Test func briefingShowsRepeatedTextOnlyOnce() throws {
        let data = Data(#"{"packet":{"references":[],"limits":[]},"briefing":{"headline":"근거 기반 브리핑","highlights":[{"text":"시장 비교 문장","evidenceIds":["latest"]}],"marketContext":[{"text":"시장 비교 문장","evidenceIds":["period"]}],"priceContext":[],"filingContext":[],"unknowns":[]},"model":"gemini","generatedAt":"2026-09-22T00:00:00Z"}"#.utf8)
        let response = try JSONDecoder().decode(BriefingResponse.self, from: data)

        #expect(response.briefing.allItems.map(\.text) == ["시장 비교 문장"])
    }

    @Test func briefingDoesNotRepeatHighlightedPeriodAsPriceContext() throws {
        let data = Data(#"{"packet":{"references":[],"limits":[]},"briefing":{"headline":"근거 기반 브리핑","highlights":[{"text":"최근 1년간 시장 비교","evidenceIds":["MARKET_COMPARISON_PERIOD"]}],"marketContext":[],"priceContext":[{"text":"최근 1년간 가격 변화","evidenceIds":["PRICE_PERIOD"]},{"text":"기간 최고가와 최저가","evidenceIds":["PRICE_RANGE"]}],"filingContext":[],"unknowns":[]},"model":"gemini","generatedAt":"2026-09-22T00:00:00Z"}"#.utf8)
        let response = try JSONDecoder().decode(BriefingResponse.self, from: data)

        #expect(response.briefing.allItems.map(\.text) == ["최근 1년간 시장 비교", "기간 최고가와 최저가"])
    }

    @Test func liveBackendContract() async throws {
        guard let rawURL = ProcessInfo.processInfo.environment["CHAPTER15_BASE_URL"] else { return }
        let client = APIClient(baseURL: try #require(URL(string: rawURL)))

        let market = try await client.market()
        #expect(market.schemaVersion == "1.0")
        #expect(market.market.indices.count == 2)

        let search = try await client.search("000660")
        #expect(search.hits.contains { $0.code == "000660" })

        let stock = try await client.stock("000660")
        #expect(stock.quote.code == "000660")
        #expect(stock.bars.count >= 200)
        #expect(stock.filings.recent.allSatisfy { $0.documentUrl.host == "dart.fss.or.kr" })

        let briefing = try await client.briefing("000660")
        #expect(!briefing.briefing.headline.isEmpty)
        #expect(!briefing.packet.references.isEmpty)
    }
}
