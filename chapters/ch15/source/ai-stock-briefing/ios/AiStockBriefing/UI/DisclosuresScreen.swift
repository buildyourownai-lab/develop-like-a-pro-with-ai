import SwiftUI

struct DisclosuresScreen: View {
    let code: String; let stockName: String
    @State private var page = 1
    @State private var state: UiState<FilingsResponse> = .loading
    private let repository = StockRepository()
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("최근 1년 전체 공시").font(.title2.weight(.semibold))
            switch state {
            case .loading: LoadingIndicator()
            case .failure(let message): Text(message)
            case .success(let response): FilingsContent(stockName: stockName, response: response, page: $page)
            }
        }.padding(16).task(id: "\(code)-\(page)") { await load() }
    }
    private func load() async {
        state = .loading
        do { state = .success(try await repository.getFilings(code: code, page: page)) }
        catch { state = .failure(error.toUserMessage()) }
    }
}

private struct FilingsContent: View {
    let stockName: String; let response: FilingsResponse
    @Binding var page: Int
    @Environment(\.appColors) private var colors
    @Environment(\.openURL) private var openURL
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("출처: \(response.source) · 조회 기간 \(formatBaseDateLabel(response.from)) ~ \(formatBaseDateLabel(response.to)) · 전체 \(response.totalCount)건 · 페이지당 20건")
                .font(.footnote).foregroundColor(colors.onSurfaceVariant)
            ScrollView { LazyVStack(spacing: 10) { ForEach(response.filings) { filing in FilingRow(filing: filing, companyName: response.corpName.isEmpty ? stockName : response.corpName) { openURL(filing.documentUrl) } } } }
            HStack {
                Button("이전 페이지") { if page > 1 { page -= 1 } }.disabled(page <= 1)
                Spacer(); Text("\(response.pageNo) / \(max(response.totalPage, 1))페이지").font(.footnote).foregroundColor(colors.onSurfaceVariant); Spacer()
                Button("다음 페이지") { if page < response.totalPage { page += 1 } }.disabled(page >= response.totalPage)
            }.padding(.top, 12)
        }
    }
}
