import SwiftUI

struct StockDetailScreen: View {
    let code: String
    @Environment(\.appColors) private var colors
    @EnvironmentObject private var router: Router
    @State private var state: UiState<StockResponse> = .loading
    @State private var query = ""
    private let repository = StockRepository()
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            AppHeader(query: $query, status: headerStatus, accessibilityPrefix: "detail") { router.goToSearch(query: $0) }
            ScrollView { if case .success(let stock) = state { StockDetailContent(stock: stock) } }
        }
        .padding(16).background(colors.surfaceVariant.ignoresSafeArea()).task(id: code) { await load() }
    }
    private var headerStatus: AppHeaderStatus {
        switch state { case .loading: return .loading; case .success: return .success; case .failure(let message): return .failure(message) }
    }
    private func load() async {
        state = .loading
        do { state = .success(try await repository.getStockDetail(code: code)) }
        catch { state = .failure(error.toUserMessage()) }
    }
}

private struct StockDetailContent: View {
    let stock: StockResponse
    @EnvironmentObject private var router: Router
    @Environment(\.appColors) private var colors
    @Environment(\.openURL) private var openURL
    private var quote: StockQuote { stock.quote }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(quote.name).font(.title2.weight(.semibold))
            Text("종목코드: \(quote.code) · \(quote.market)").font(.footnote).foregroundColor(colors.onSurfaceVariant)
            Text(formatPrice(quote.close)).font(.title.weight(.semibold))
            ChangeIndicator(value: quote.diff, visibleText: "\(formatChange(quote.diff)) (\(formatChangeRate(quote.changeRate)))")
            Text("기준일: \(formatBaseDateLabel(quote.baseDate))").font(.footnote).foregroundColor(colors.onSurfaceVariant)
            if quote.baseDate != stock.marketBaseDate {
                Text("시장 전체 기준일(\(formatBaseDateLabel(stock.marketBaseDate)))과 이 종목의 기준일이 다릅니다.").font(.footnote).foregroundColor(.noticeColor)
            }
            Divider().padding(.vertical, 12)
            Text("상세 시세").font(.headline)
            ListCard {
                DetailRow(label: "시가", value: formatPrice(quote.open)); DetailRow(label: "고가", value: formatPrice(quote.high))
                DetailRow(label: "저가", value: formatPrice(quote.low)); DetailRow(label: "거래량", value: formatVolume(quote.volume))
                DetailRow(label: "거래대금", value: formatTradingValue(quote.tradeValue))
            }
            Divider().padding(.vertical, 12)
            Text("최근 1년 주가 흐름").font(.headline)
            if let first = stock.bars.first, let last = stock.bars.last {
                Text("\(formatBaseDateLabel(first.date)) ~ \(formatBaseDateLabel(last.date)) · 제공 거래일 \(stock.bars.count)일")
                    .font(.footnote)
                    .foregroundColor(colors.onSurfaceVariant)
            }
            StockChart(bars: stock.bars)
            Divider().padding(.vertical, 12)
            Text("최근 1년 공시").font(.headline)
            if stock.filings.state == "error" { Text("공시만 가져오지 못했습니다. 나머지 정보는 정상입니다.") }
            else if stock.filings.state == "none" { Text("연결된 공시가 없습니다.") }
            else {
                Text("출처: 금융감독원 OpenDART · 조회 기간 \(formatBaseDateLabel(stock.filings.from ?? "")) ~ \(formatBaseDateLabel(stock.filings.to ?? "")) · 전체 \(stock.filings.totalCount)건").font(.footnote).foregroundColor(colors.onSurfaceVariant)
                ForEach(stock.filings.recent) { filing in FilingRow(filing: filing, companyName: stock.filings.corpName ?? quote.name) { openURL(filing.documentUrl) } }
                Button(action: { router.goToDisclosures(code: quote.code, name: quote.name) }) { HStack { Text("전체 공시 \(stock.filings.totalCount)건 보기"); NavigationChevron() } }
                    .buttonStyle(.plain).accessibilityIdentifier("viewAllDisclosuresButton")
            }
            Divider().padding(.vertical, 12)
            AiBriefingSection(code: quote.code)
        }
    }
}

private struct DetailRow: View {
    let label: String; let value: String
    @Environment(\.appColors) private var colors
    var body: some View { HStack { Text(label).foregroundColor(colors.onSurfaceVariant); Spacer(); Text(value).fontWeight(.medium) } }
}

struct FilingRow: View {
    let filing: Filing; let companyName: String; let onTap: () -> Void
    @Environment(\.appColors) private var colors
    var body: some View {
        ListCard(onTap: onTap) {
            Text(formatBaseDateLabel(filing.receiptDate)).font(.footnote).foregroundColor(colors.onSurfaceVariant)
            Text(filing.reportName).fontWeight(.medium)
            Text(submitterLabel(filing.filerName, companyName: companyName)).font(.footnote).foregroundColor(colors.onSurfaceVariant)
            if !filing.noteLabels.isEmpty { Text(filing.noteLabels.joined(separator: " · ")).font(.footnote) }
            DartOriginalLinkLabel()
        }
    }
}
