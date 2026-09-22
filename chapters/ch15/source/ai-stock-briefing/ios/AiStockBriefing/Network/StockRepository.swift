import Foundation

// 화면에서 쓸 자료를 서버(JSON API)에서만 받아온다. 시세·공시·AI 브리핑을
// 이 앱이 직접 계산하지 않고, 이미 확인·검증까지 마친 서버의 결과만 그대로
// 보여준다.
struct StockRepository {
    let client: ApiClient

    init(client: ApiClient = .shared) {
        self.client = client
    }

    func getMarket() async throws -> MarketResponse {
        let data = try await client.get(path: ["api", "mobile", "market"])
        return try ApiClient.decodeOrThrow(MarketResponse.self, from: data)
    }

    func search(query: String) async throws -> SearchResponse {
        let data = try await client.get(path: ["api", "mobile", "stocks", "search"], query: ["q": query])
        return try ApiClient.decodeOrThrow(SearchResponse.self, from: data)
    }

    func getStockDetail(code: String) async throws -> StockResponse {
        let data = try await client.get(path: ["api", "mobile", "stocks", code])
        return try ApiClient.decodeOrThrow(StockResponse.self, from: data)
    }

    func getFilings(code: String, page: Int) async throws -> FilingsResponse {
        let data = try await client.get(path: ["api", "mobile", "stocks", code, "filings"], query: ["page": String(page)])
        return try ApiClient.decodeOrThrow(FilingsResponse.self, from: data)
    }

    func postBriefing(code: String) async throws -> BriefingResponse {
        let data = try await client.post(path: ["api", "stocks", code, "briefing"])
        return try ApiClient.decodeOrThrow(BriefingResponse.self, from: data)
    }
}
