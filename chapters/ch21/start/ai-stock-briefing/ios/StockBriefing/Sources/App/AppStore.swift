import Foundation

@MainActor
final class AppStore: ObservableObject {
    @Published var market: MarketResponse?
    @Published var searchResults: SearchResponse?
    @Published var selectedStock: StockResponse?
    @Published var briefing: BriefingResponse?
    @Published var query = ""
    @Published var isLoading = false
    @Published var message = "데이터를 불러오는 중입니다."
    @Published var errorMessage: String?

    let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func loadMarket() async {
        await perform {
            market = try await client.market()
            selectedStock = nil
            briefing = nil
            searchResults = nil
        }
    }

    func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = "종목명 또는 종목코드를 입력해 주세요."
            return
        }
        await perform {
            let response = try await client.search(trimmed)
            selectedStock = nil
            briefing = nil
            if let onlyHit = response.hits.count == 1 ? response.hits.first : nil {
                selectedStock = try await client.stock(onlyHit.code)
                searchResults = nil
            } else {
                searchResults = response
            }
        }
    }

    func select(code: String) async {
        await perform {
            selectedStock = try await client.stock(code)
            briefing = nil
        }
    }

    func loadBriefing() async {
        guard let code = selectedStock?.quote.code else { return }
        await perform { briefing = try await client.briefing(code) }
    }

    private func perform(_ operation: () async throws -> Void) async {
        isLoading = true
        errorMessage = nil
        message = "데이터를 불러오는 중입니다."
        defer { isLoading = false }
        do {
            try await operation()
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "서버에 연결하지 못했습니다."
        }
    }
}
