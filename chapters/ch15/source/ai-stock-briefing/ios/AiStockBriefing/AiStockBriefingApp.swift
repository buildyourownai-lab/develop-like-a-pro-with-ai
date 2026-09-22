import SwiftUI

@main
struct AiStockBriefingApp: App {
    @StateObject private var router = Router()

    init() {
        // 실행 인자("-UITestFixtures")가 없으면 아무 일도 하지 않는다 — 일반
        // 실행·배포판은 항상 실제 서버(ApiClient.defaultBaseURL)만 부른다.
        UITestSupport.installFixturesIfNeeded()
    }

    var body: some Scene {
        WindowGroup {
            NavigationStack(path: $router.path) {
                MarketScreen()
                    .navigationDestination(for: Route.self) { route in
                        switch route {
                        case .search(let query):
                            SearchScreen(query: query)
                        case .stock(let code):
                            StockDetailScreen(code: code)
                        case .disclosures(let code, let name):
                            DisclosuresScreen(code: code, stockName: name)
                        }
                    }
            }
            .environmentObject(router)
            .appTheme()
        }
    }
}
