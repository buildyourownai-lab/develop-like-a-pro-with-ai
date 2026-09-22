import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum APIEndpoint: Sendable {
    case market
    case search(String)
    case stock(String)
    case filings(String)
    case briefing(String)

    public var method: String {
        if case .briefing = self { return "POST" }
        return "GET"
    }

    public func url(relativeTo baseURL: URL) throws -> URL {
        switch self {
        case .market:
            return baseURL.appending(path: "api/mobile/market")
        case .search(let query):
            guard var parts = URLComponents(
                url: baseURL.appending(path: "api/mobile/stocks/search"),
                resolvingAgainstBaseURL: false
            ) else { throw APIClientError.invalidConfiguration }
            parts.queryItems = [URLQueryItem(name: "q", value: query)]
            guard let url = parts.url else { throw APIClientError.invalidConfiguration }
            return url
        case .stock(let code):
            return baseURL.appending(path: "api/mobile/stocks/\(code)")
        case .filings(let code):
            return baseURL.appending(path: "api/mobile/stocks/\(code)/filings")
        case .briefing(let code):
            return baseURL.appending(path: "api/stocks/\(code)/briefing")
        }
    }
}
public enum APIClientError: LocalizedError, Sendable {
    case invalidConfiguration
    case invalidResponse
    case server(String)

    public var errorDescription: String? {
        switch self {
        case .invalidConfiguration:
            return "서버 주소가 올바르지 않습니다."
        case .invalidResponse:
            return "서버 응답 형식을 확인하지 못했습니다."
        case .server(let message):
            return message
        }
    }
}

public struct APIClient: Sendable {
    public let baseURL: URL
    private let session: URLSession

    public init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    public func market() async throws -> MarketResponse {
        try await request(.market, as: MarketResponse.self)
    }

    public func search(_ query: String) async throws -> SearchResponse {
        try await request(.search(query), as: SearchResponse.self)
    }

    public func stock(_ code: String) async throws -> StockResponse {
        try await request(.stock(code), as: StockResponse.self)
    }

    public func briefing(_ code: String) async throws -> BriefingResponse {
        try await request(.briefing(code), as: BriefingResponse.self)
    }

    private func request<T: Decodable & Sendable>(_ endpoint: APIEndpoint, as type: T.Type) async throws -> T {
        var request = URLRequest(url: try endpoint.url(relativeTo: baseURL))
        request.httpMethod = endpoint.method
        request.timeoutInterval = 60
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if endpoint.method == "POST" { request.httpBody = Data() }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIClientError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            let body = try? JSONDecoder().decode(APIErrorBody.self, from: data)
            throw APIClientError.server(body?.error ?? "서버 요청이 실패했습니다.")
        }
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw APIClientError.invalidResponse
        }
    }
}
