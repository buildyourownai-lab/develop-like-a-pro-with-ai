import SwiftUI

struct ContentView: View {
    @StateObject var store: AppStore
    @FocusState private var searchFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    searchBar
                    status
                    if let stock = store.selectedStock {
                        StockDetailView(stock: stock, briefing: store.briefing) {
                            Task { await store.loadBriefing() }
                        }
                    } else if let results = store.searchResults {
                        searchResults(results)
                    } else if let market = store.market?.market {
                        MarketView(market: market) { code in
                            Task { await store.select(code: code) }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
            }
            .background(webBackground)
            .navigationTitle("국내 주식 한눈에")
            .task {
                if store.market == nil { await store.loadMarket() }
            }
        }
    }

    private var searchBar: some View {
        HStack(spacing: 10) {
            TextField("종목명 또는 종목코드", text: $store.query)
                .padding(.horizontal, 14)
                .frame(height: 48)
                .background(.background, in: RoundedRectangle(cornerRadius: 13))
                .overlay {
                    RoundedRectangle(cornerRadius: 13)
                        .stroke(Color.secondary.opacity(0.18), lineWidth: 1)
                }
                .accessibilityIdentifier("stock-search-field")
                .focused($searchFocused)
                .submitLabel(.search)
                .onSubmit {
                    searchFocused = false
                    Task { await store.search() }
                }
            Button("검색") {
                searchFocused = false
                Task { await store.search() }
            }
                .buttonStyle(.borderedProminent)
                .tint(webAccent)
                .controlSize(.large)
                .accessibilityIdentifier("stock-search-button")
        }
        .padding(.top, 4)
    }

    private let webBackground = Color(red: 244 / 255, green: 246 / 255, blue: 250 / 255)
    private let webAccent = Color(red: 28 / 255, green: 72 / 255, blue: 184 / 255)

    @ViewBuilder private var status: some View {
        if store.isLoading {
            HStack { ProgressView(); Text(store.message) }
                .font(.footnote)
                .foregroundStyle(.secondary)
        } else if let error = store.errorMessage {
            Text(error).font(.footnote).foregroundStyle(.red)
        }
    }

    private func searchResults(_ response: SearchResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle("‘\(response.query)’ 검색 결과 \(response.hits.count)건")
            Text("상장종목 기준일 \(response.baseDate.koreanDate)")
                .font(.footnote).foregroundStyle(.secondary)
            if response.hits.isEmpty { Card { Text("일치하는 종목이 없습니다.") } }
            ForEach(response.hits) { hit in
                Button {
                    Task { await store.select(code: hit.code) }
                } label: {
                    Card {
                        Text("\(hit.name) · \(hit.code)").font(.headline)
                        Text("\(hit.corpName) · \(hit.market)").foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct MarketView: View {
    let market: MarketSnapshot
    let select: (String) -> Void

    var body: some View {
        Text("주식시세 기준일 \(market.priceBaseDate.koreanDate)")
            .font(.footnote).foregroundStyle(.secondary)
        HStack(spacing: 10) {
            ForEach(market.indices) { index in
                Card {
                    Text(index.name).font(.headline)
                    HStack(alignment: .center) {
                        Text(index.close.number).font(.title3.bold())
                        Spacer(minLength: 8)
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(index.diff.signedIndexChange).font(.subheadline.bold())
                            Text("(\(index.changeRate.signedRate))").font(.caption.bold())
                        }
                        .foregroundStyle(index.changeRate.marketColor)
                    }
                    Text("거래대금 \(index.tradeValue.tradeValueLabel)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        moverSection("상승률 상위", quotes: Array(market.gainers.prefix(5)), rising: true)
        moverSection("하락률 상위", quotes: Array(market.losers.prefix(5)), rising: false)
        Text("금융위원회 공식 주식 데이터 · 종목을 누르면 상세 화면으로 이동합니다.")
            .font(.footnote).foregroundStyle(.secondary)
    }

    @ViewBuilder private func moverSection(_ title: String, quotes: [StockQuote], rising: Bool) -> some View {
        HStack(spacing: 9) {
            Image(systemName: rising ? "arrow.up" : "arrow.down")
                .font(.caption.bold())
                .foregroundStyle(rising ? upColor : downColor)
                .frame(width: 30, height: 30)
                .background((rising ? upColor : downColor).opacity(0.10), in: Circle())
            Text(title).font(.title2.bold())
        }
        .padding(.top, 6)
        ForEach(quotes) { quote in
            Button { select(quote.code) } label: {
                Card {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(quote.name)
                                .font(.headline)
                                .lineLimit(1)
                                .minimumScaleFactor(0.75)
                            Text(quote.code)
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 4)
                        VStack(alignment: .trailing, spacing: 5) {
                            Text("\(quote.close.number)원").font(.headline)
                            Text(quote.changeRate.signedRate)
                                .font(.subheadline.bold())
                                .foregroundStyle(quote.changeRate.marketColor)
                        }
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("market-stock-\(quote.code)")
        }
    }

    private let upColor = Color(red: 198 / 255, green: 40 / 255, blue: 40 / 255)
    private let downColor = Color(red: 18 / 255, green: 86 / 255, blue: 196 / 255)
}

struct SectionTitle: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View { Text(text).font(.title2.bold()).padding(.top, 6) }
}

struct Card<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 6) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(.background, in: RoundedRectangle(cornerRadius: 14))
            .overlay {
                RoundedRectangle(cornerRadius: 14)
                    .stroke(Color(red: 227 / 255, green: 232 / 255, blue: 240 / 255), lineWidth: 1)
            }
            .shadow(color: Color(red: 16 / 255, green: 25 / 255, blue: 43 / 255).opacity(0.06), radius: 8, y: 3)
    }
}

extension String {
    var koreanDate: String {
        guard count == 8 else { return self }
        return "\(prefix(4)).\(dropFirst(4).prefix(2)).\(suffix(2))"
    }
}

extension Double {
    var number: String { formatted(.number.precision(.fractionLength(0))) }
    var signedRate: String { String(format: "%+.2f%%", self) }
    var signedNumber: String { self > 0 ? "+\(number)" : number }
    var signedIndexChange: String {
        let value = formatted(.number.precision(.fractionLength(0...3)))
        return self > 0 ? "+\(value)" : value
    }
    var tradeValueLabel: String {
        let eok = Int64((self / 100_000_000).rounded())
        let jo = eok / 10_000
        let remainder = eok % 10_000
        if jo == 0 { return "\(remainder.formatted())억원" }
        return "\(jo.formatted())조 \(remainder.formatted())억원"
    }
    var marketColor: Color {
        if self > 0 { return Color(red: 198 / 255, green: 40 / 255, blue: 40 / 255) }
        if self < 0 { return Color(red: 18 / 255, green: 86 / 255, blue: 196 / 255) }
        return .secondary
    }
}
