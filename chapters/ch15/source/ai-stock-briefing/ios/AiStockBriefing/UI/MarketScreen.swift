import SwiftUI

struct MarketScreen: View {
    @EnvironmentObject private var router: Router
    @Environment(\.appColors) private var colors
    @State private var state: UiState<MarketResponse> = .loading
    @State private var query: String = ""
    private let repository = StockRepository()

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            AppHeader(
                query: $query,
                status: headerStatus,
                accessibilityPrefix: "market",
                onSearch: submitSearch
            )

            switch state {
            case .loading:
                EmptyView()
            case .failure:
                EmptyView()
            case .success(let overview):
                MarketContent(overview: overview.market)
            }
        }
        .padding(16)
        .background(colors.surfaceVariant.ignoresSafeArea())
        .task { await load() }
    }

    private var headerStatus: AppHeaderStatus {
        switch state {
        case .loading: return .loading
        case .success: return .success
        case .failure(let message): return .failure(message)
        }
    }

    private func submitSearch(_ query: String) {
        router.goToSearch(query: query)
    }

    private func load() async {
        do {
            let overview = try await repository.getMarket()
            state = .success(overview)
        } catch {
            state = .failure(error.toUserMessage())
        }
    }
}

private struct MarketContent: View {
    let overview: MarketSnapshot
    @Environment(\.appColors) private var colors

    // 같은 기준일은 한 번만 보여주고, 지수와 종목 날짜가 다를 때만 차이를 알린다.
    private var indexBaseDate: String? { overview.indexBaseDate }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                Text("주식시세 기준일 \(formatBaseDateLabel(overview.priceBaseDate))")
                    .font(.footnote)
                    .foregroundColor(colors.onSurfaceVariant)

                if let indexBaseDate, indexBaseDate != overview.priceBaseDate {
                    Text(
                        "지수 기준일(\(formatBaseDateLabel(indexBaseDate)))과 종목 시세 기준일(" +
                        "\(formatBaseDateLabel(overview.priceBaseDate)))이 다릅니다."
                    )
                    .font(.footnote)
                    .foregroundColor(.noticeColor)
                }

                HStack(spacing: 10) {
                    ForEach(overview.indices) { index in
                        IndexCard(index: index)
                            .frame(maxWidth: .infinity)
                    }
                }

                MoverHeading(title: "상승률 상위", rising: true)
                ForEach(overview.gainers) { stock in
                    RankedStockCard(stock: stock)
                }

                MoverHeading(title: "하락률 상위", rising: false)
                ForEach(overview.losers) { stock in
                    RankedStockCard(stock: stock)
                }

                Text("금융위원회 공식 주식 데이터 · 종목을 누르면 상세 화면으로 이동합니다.")
                .font(.footnote)
                .foregroundColor(colors.onSurfaceVariant)
                .padding(.top, 20)
            }
        }
    }
}

private struct IndexCard: View {
    let index: IndexQuote
    @Environment(\.appColors) private var colors

    var body: some View {
        ListCard {
            VStack(alignment: .leading, spacing: 4) {
                Text(index.name)
                    .fontWeight(.bold)
                    .accessibilityIdentifier("market-index-\(index.name)")
                HStack(alignment: .center) {
                    Text(formatIndexValue(index.close)).font(.title3.weight(.bold))
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(formatChange(index.diff)).fontWeight(.bold)
                        Text("(\(formatChangeRate(index.changeRate)))")
                            .font(.caption.weight(.bold))
                    }
                    .foregroundColor(colors.direction(index.changeRate))
                }
                Text("거래대금 \(formatTradingValue(index.tradeValue))")
                    .font(.caption)
                    .foregroundColor(colors.onSurfaceVariant)
            }
        }
    }
}

private struct RankedStockCard: View {
    let stock: StockQuote
    @EnvironmentObject private var router: Router
    @Environment(\.appColors) private var colors

    var body: some View {
        ListCard(onTap: { router.goToStock(code: stock.code) }) {
            HStack {
                VStack(alignment: .leading, spacing: 5) {
                    Text(stock.name).fontWeight(.bold)
                    Text(stock.code)
                        .font(.caption.monospacedDigit())
                        .foregroundColor(colors.onSurfaceVariant)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 5) {
                    Text(formatPrice(stock.close)).fontWeight(.bold)
                    Text(formatChangeRate(stock.changeRate))
                        .fontWeight(.bold)
                    .foregroundColor(colors.direction(stock.changeRate))
                }
            }
        }
    }
}

private struct MoverHeading: View {
    let title: String
    let rising: Bool
    @Environment(\.appColors) private var colors

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: rising ? "arrow.up" : "arrow.down")
                .font(.caption.weight(.bold))
                .foregroundColor(colors.direction(rising ? 1 : -1))
                .frame(width: 30, height: 30)
                .background(colors.direction(rising ? 1 : -1).opacity(0.10), in: Circle())
            Text(title).font(.title2.weight(.bold))
        }
        .padding(.top, 16)
        .padding(.bottom, 4)
    }
}
