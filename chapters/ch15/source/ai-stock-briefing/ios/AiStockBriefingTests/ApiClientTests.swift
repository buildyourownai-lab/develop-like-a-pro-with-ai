import XCTest
@testable import AiStockBriefing

// 실제 네트워크를 타지 않도록 URLProtocol을 목(mock)으로 쓴다 — 인증키가
// 없는 이 환경에서는 실제 API를 호출하는 테스트를 쓰지 않는다.
final class MockURLProtocol: URLProtocol {
    struct Stub {
        let statusCode: Int
        let body: Data
    }

    // 요청 URL(path+query 없이 절대경로만) -> 응답
    static var stubs: [String: Stub] = [:]
    static var stubError: Error?
    static var lastRequest: URLRequest?

    static func key(for url: URL) -> String {
        url.absoluteString
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        MockURLProtocol.lastRequest = request
        if let error = MockURLProtocol.stubError {
            client?.urlProtocol(self, didFailWithError: error)
            return
        }
        guard let url = request.url, let stub = MockURLProtocol.stubs[MockURLProtocol.key(for: url)] else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        let response = HTTPURLResponse(url: url, statusCode: stub.statusCode, httpVersion: "HTTP/1.1", headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: stub.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class ApiClientTests: XCTestCase {
    var session: URLSession!
    var client: ApiClient!
    var repository: StockRepository!
    let baseURL = URL(string: "https://mock.test")!

    override func setUp() {
        super.setUp()
        MockURLProtocol.stubs = [:]
        MockURLProtocol.stubError = nil
        MockURLProtocol.lastRequest = nil
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        session = URLSession(configuration: config)
        client = ApiClient(baseURL: baseURL, session: session)
        repository = StockRepository(client: client)
    }

    func testGetMarketDecodesSuccessResponse() async throws {
        let json = """
        {
          "schemaVersion": "1.0", "source": "data.go.kr",
          "market": {"priceBaseDate": "20240115", "indexBaseDate": null, "indices": [],
          "gainers": [], "losers": [], "universeCount": 1, "rankedCount": 1}
        }
        """
        MockURLProtocol.stubs[MockURLProtocol.key(for: baseURL.appendingPathComponent("api/mobile/market"))] =
            .init(statusCode: 200, body: Data(json.utf8))

        let overview = try await repository.getMarket()
        XCTAssertEqual(overview.market.priceBaseDate, "20240115")
    }

    func testGetMarketThrowsUserReadableErrorOnServerErrorBody() async {
        let json = """
        {"error": "시세 정보를 가져오지 못했습니다.", "code": "UPSTREAM", "retryable": true}
        """
        MockURLProtocol.stubs[MockURLProtocol.key(for: baseURL.appendingPathComponent("api/mobile/market"))] =
            .init(statusCode: 502, body: Data(json.utf8))

        do {
            _ = try await repository.getMarket()
            XCTFail("Expected an error to be thrown")
        } catch {
            XCTAssertEqual(error.toUserMessage(), "시세 정보를 가져오지 못했습니다.")
        }
    }

    func testEmptyBodyProducesUserReadableMessage() async {
        MockURLProtocol.stubs[MockURLProtocol.key(for: baseURL.appendingPathComponent("api/mobile/market"))] =
            .init(statusCode: 200, body: Data())

        do {
            _ = try await repository.getMarket()
            XCTFail("Expected an error to be thrown")
        } catch {
            XCTAssertEqual(error.toUserMessage(), "서버 응답 형식을 확인하지 못했습니다.")
        }
    }

    func testNetworkFailureMapsToConnectivityMessage() async {
        MockURLProtocol.stubError = URLError(.notConnectedToInternet)

        do {
            _ = try await repository.getMarket()
            XCTFail("Expected an error to be thrown")
        } catch {
            XCTAssertEqual(error.toUserMessage(), "인터넷 연결을 확인해 주세요. 연결이 되면 다시 시도해 보세요.")
        }
    }

    func testSearchSendsQueryParameter() async throws {
        let json = """
        {"schemaVersion":"1.0","source":"data.go.kr","query":"삼성","baseDate":"20240115","hits":[{"code":"005930","name":"삼성전자","market":"KOSPI","corpName":"삼성전자","baseDate":"20240115"}]}
        """
        let url = baseURL.appendingPathComponent("api/mobile/stocks/search")
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "q", value: "삼성")]
        MockURLProtocol.stubs[MockURLProtocol.key(for: components.url!)] =
            .init(statusCode: 200, body: Data(json.utf8))

        let response = try await repository.search(query: "삼성")
        XCTAssertEqual(response.hits.first?.code, "005930")
    }

    func testDetailUsesMobileRoute() async throws {
        let json = #"{"schemaVersion":"1.0","sources":[],"marketBaseDate":"20240115","quote":{"baseDate":"20240115","code":"005930","name":"삼성전자","market":"KOSPI","close":1,"diff":0,"changeRate":0,"open":1,"high":1,"low":1,"volume":1,"tradeValue":1},"bars":[],"filings":{"state":"none","corpName":null,"from":null,"to":null,"totalCount":0,"recent":[]}}"#
        let url = baseURL.appendingPathComponent("api/mobile/stocks/005930")
        MockURLProtocol.stubs[url.absoluteString] = .init(statusCode: 200, body: Data(json.utf8))
        _ = try await repository.getStockDetail(code: "005930")
        XCTAssertEqual(MockURLProtocol.lastRequest?.url, url)
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "GET")
    }

    func testFilingsUsesMobileRouteAndPage() async throws {
        let json = #"{"schemaVersion":"1.0","source":"OpenDART","code":"005930","corpName":"삼성전자","from":"20230101","to":"20240101","filings":[],"totalCount":0,"pageNo":2,"totalPage":0}"#
        var parts = URLComponents(url: baseURL.appendingPathComponent("api/mobile/stocks/005930/filings"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "page", value: "2")]
        MockURLProtocol.stubs[parts.url!.absoluteString] = .init(statusCode: 200, body: Data(json.utf8))
        _ = try await repository.getFilings(code: "005930", page: 2)
        XCTAssertEqual(MockURLProtocol.lastRequest?.url, parts.url)
    }

    func testBriefingUsesLegacyPostRoute() async throws {
        let json = #"{"packet":{"references":[],"limits":[]},"briefing":{"headline":"h","highlights":[],"marketContext":[],"priceContext":[],"filingContext":[],"unknowns":[]},"model":"m","generatedAt":"now"}"#
        let url = baseURL.appendingPathComponent("api/stocks/005930/briefing")
        MockURLProtocol.stubs[url.absoluteString] = .init(statusCode: 200, body: Data(json.utf8))
        _ = try await repository.postBriefing(code: "005930")
        XCTAssertEqual(MockURLProtocol.lastRequest?.url, url)
        XCTAssertEqual(MockURLProtocol.lastRequest?.httpMethod, "POST")
    }

    func testMalformedSuccessAndNonJSONErrorAreReadable() async {
        let url = baseURL.appendingPathComponent("api/mobile/market")
        MockURLProtocol.stubs[url.absoluteString] = .init(statusCode: 200, body: Data("{}".utf8))
        do { _ = try await repository.getMarket(); XCTFail("Expected malformed response") }
        catch { XCTAssertEqual(error.toUserMessage(), "서버 응답 형식을 확인하지 못했습니다.") }
        MockURLProtocol.stubs[url.absoluteString] = .init(statusCode: 503, body: Data("unavailable".utf8))
        do { _ = try await repository.getMarket(); XCTFail("Expected HTTP error") }
        catch { XCTAssertEqual(error.toUserMessage(), "서버 요청이 실패했습니다.") }
    }
}
