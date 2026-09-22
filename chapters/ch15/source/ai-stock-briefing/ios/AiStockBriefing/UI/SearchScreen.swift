import SwiftUI

struct SearchScreen: View {
    let query: String
    @EnvironmentObject private var router: Router
    @Environment(\.appColors) private var colors
    @State private var state: UiState<SearchResponse> = .loading
    @State private var searchQuery: String
    private let repository = StockRepository()

    init(query: String) {
        self.query = query
        _searchQuery = State(initialValue: query)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            AppHeader(
                query: $searchQuery,
                status: headerStatus,
                accessibilityPrefix: "results",
                onSearch: { router.goToSearch(query: $0) }
            )
            Text("\"\(query)\" 검색 결과")
                .font(.title2.weight(.semibold))

            switch state {
            case .loading:
                EmptyView()
            case .failure:
                EmptyView()
            case .success(let response):
                Text("상장종목 기준일: \(formatBaseDateLabel(response.baseDate))")
                    .font(.footnote).foregroundColor(colors.onSurfaceVariant)
                SearchResultContent(results: response.hits)
            }
        }
        .padding(16)
        .background(colors.surfaceVariant.ignoresSafeArea())
        .task(id: query) { await load() }
    }

    private var headerStatus: AppHeaderStatus {
        switch state {
        case .loading: return .loading
        case .success: return .success
        case .failure(let message): return .failure(message)
        }
    }

    private func load() async {
        state = .loading
        do {
            let response = try await repository.search(query: query)
            state = .success(response)
        } catch {
            state = .failure(error.toUserMessage())
        }
    }
}

private struct SearchResultContent: View {
    let results: [SearchHit]
    @EnvironmentObject private var router: Router
    @Environment(\.appColors) private var colors

    var body: some View {
        // 결과가 정확히 하나면 웹(검색 결과 화면)과 같이 곧바로 상세 화면으로
        // 이동한다. 검색 화면은 뒤로 가기에 남지 않게 스택에서 제거한다.
        if results.count == 1 {
            Color.clear
                .onAppear {
                    router.replaceStackWithStock(code: results[0].code)
                }
        } else if results.isEmpty {
            ListCard {
                Text("일치하는 종목이 없습니다. 종목명 전체나 여섯 자리 종목코드로 다시 검색해 보세요.")
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("일치하는 종목이 없습니다. 종목명 전체나 여섯 자리 종목코드로 다시 검색해 보세요.")
        } else {
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(results) { result in
                        ListCard(onTap: { router.replaceStackWithStock(code: result.code) }) {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(result.name).fontWeight(.bold)
                                    Text("\(result.code) · \(result.market)")
                                        .font(.footnote)
                                        .foregroundColor(colors.onSurfaceVariant)
                                    if result.corpName != result.name {
                                        Text("법인명: \(result.corpName)").font(.footnote).foregroundColor(colors.onSurfaceVariant)
                                    }
                                    Text("기준일: \(formatBaseDateLabel(result.baseDate))").font(.footnote).foregroundColor(colors.onSurfaceVariant)
                                }
                                Spacer()
                                NavigationChevron()
                            }
                        }
                    }
                }
            }
        }
    }
}
