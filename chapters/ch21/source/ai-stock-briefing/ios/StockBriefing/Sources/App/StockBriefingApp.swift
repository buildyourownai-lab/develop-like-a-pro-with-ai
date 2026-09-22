import SwiftUI

@main
struct StockBriefingApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView(store: AppStore(client: .configured()))
        }
    }
}

private extension APIClient {
    static func configured() -> APIClient {
        #if DEBUG
        let override = ProcessInfo.processInfo.environment["API_BASE_URL_OVERRIDE"]
        #else
        let override: String? = nil
        #endif
        let value = override ?? (Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String)
        let url = value.flatMap(URL.init(string:)) ?? URL(string: "https://example.invalid")!
        return APIClient(baseURL: url)
    }
}
