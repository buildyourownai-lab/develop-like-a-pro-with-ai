import Foundation

// 서버(Next.js API)가 이미 사람이 읽을 말로 만들어 보낸 에러 메시지를 그대로
// 담는 예외다. Android network/ApiClient.kt의 ApiException과 같은 역할.
struct ApiException: Error, LocalizedError {
    let message: String

    var errorDescription: String? { message }
}

// 서버가 만든 결과만 받는다 — 외부 서비스 인증키(공공데이터포털·OpenDART·
// Gemini)는 이 앱 어디에도 넣지 않는다. 서버 주소만 빌드 타입별로 다르다
// (Debug는 localhost:3000, Release는 실제 Vercel 배포 주소).
final class ApiClient {
    static let shared = ApiClient()

    let baseURL: URL
    private let session: URLSession

    static var defaultBaseURL: URL {
        #if DEBUG
        return URL(string: "http://localhost:3000")!
        #else
        return URL(string: "https://ai-stock-briefing.vercel.app")!
        #endif
    }

    init(baseURL: URL = ApiClient.defaultBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    private func url(path: [String], query: [String: String] = [:]) -> URL {
        var url = baseURL
        for segment in path {
            url.appendPathComponent(segment)
        }
        guard !query.isEmpty else { return url }
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        return components.url ?? url
    }

    func get(path: [String], query: [String: String] = [:]) async throws -> Data {
        let request = URLRequest(url: url(path: path, query: query))
        return try await execute(request)
    }

    func post(path: [String]) async throws -> Data {
        var request = URLRequest(url: url(path: path))
        request.httpMethod = "POST"
        request.httpBody = Data()
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return try await execute(request)
    }

    private func execute(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ApiException(message: "서버 응답 형식을 확인하지 못했습니다.")
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = try? JSONDecoder().decode(APIErrorBody.self, from: data)
            throw ApiException(message: body?.error ?? "서버 요청이 실패했습니다.")
        }
        if data.isEmpty {
            throw ApiException(message: "서버 응답 형식을 확인하지 못했습니다.")
        }
        return data
    }

    // 이 프로젝트의 API는 전체 실패일 때만 {error: "..."} 하나만 돌려주고
    // (예: 종목을 찾지 못한 404), 정상 응답에는 최상위 error가 없다. 먼저
    // 그 실패 형태인지 확인해, 맞으면 그 메시지로 예외를 던진다 — 없으면
    // 다른 필드가 없어 T로 바로 디코딩하면 실패하기 때문이다.
    static func decodeOrThrow<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        if let error = try? JSONDecoder().decode(APIErrorBody.self, from: data) {
            throw ApiException(message: error.error)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw ApiException(message: "서버 응답 형식을 확인하지 못했습니다.")
        }
    }
}
