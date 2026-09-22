import SwiftUI

// Android NavHostController와 같은 역할 — 화면 이동 경로를 하나의 스택으로
// 관리한다. search 화면은 popUpTo("market")와 같은 뜻으로, path를 통째로
// 새 배열로 바꿔서 검색 화면이 뒤로가기 스택에 남지 않게 한다.
enum Route: Hashable {
    case search(query: String)
    case stock(code: String)
    case disclosures(code: String, name: String)
}

final class Router: ObservableObject {
    @Published var path: [Route] = []

    func goToSearch(query: String) {
        path.append(.search(query: query))
    }

    func goToStock(code: String) {
        path.append(.stock(code: code))
    }

    // 검색 화면에서 상세로 넘어갈 때 검색 화면 자체를 스택에서 제거한다
    // (Android popUpTo("market")과 같은 뜻).
    func replaceStackWithStock(code: String) {
        path = [.stock(code: code)]
    }

    func goToDisclosures(code: String, name: String) {
        path.append(.disclosures(code: code, name: name))
    }
}
