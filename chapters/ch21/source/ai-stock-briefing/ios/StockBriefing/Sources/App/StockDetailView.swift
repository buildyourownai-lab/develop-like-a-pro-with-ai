import SwiftUI

struct StockDetailView: View {
    let stock: StockResponse
    let briefing: BriefingResponse?
    let requestBriefing: () -> Void

    var body: some View {
        let quote = stock.quote
        SectionTitle("\(quote.name)  \(quote.code)").accessibilityIdentifier("stock-detail-title")
        Card {
            Text("\(quote.close.number)원").font(.title.bold())
            Text("\(quote.diff.signedNumber) · \(quote.changeRate.signedRate)")
                .font(.headline)
                .foregroundStyle(quote.changeRate.marketColor)
            Text("기준일 \(quote.baseDate.koreanDate)").font(.footnote).foregroundStyle(.secondary)
        }
        Card {
            Text("가격과 거래").font(.headline)
            Text("시가 \(quote.open.number)원 · 고가 \(quote.high.number)원")
            Text("저가 \(quote.low.number)원 · 거래량 \(quote.volume.number)주")
        }
        SectionTitle("최근 1년 주가 흐름").accessibilityIdentifier("price-chart-title")
        if let first = stock.bars.first, let last = stock.bars.last {
            Text("\(first.date.koreanDate) ~ \(last.date.koreanDate) · 제공 거래일 \(stock.bars.count)일")
                .font(.footnote).foregroundStyle(.secondary)
            PriceChart(bars: stock.bars)
        }
        SectionTitle("이 회사 관련 공시").accessibilityIdentifier("filings-title")
        if stock.filings.state == "ready" {
            Text("최근 1년 접수 공시 \(stock.filings.totalCount)건 · DART 원문이 최종 근거입니다.")
                .font(.footnote).foregroundStyle(.secondary)
            ForEach(stock.filings.recent) { filing in
                Link(destination: filing.documentUrl) {
                    Card {
                        Text("\(filing.receiptDate.koreanDate) · \(filing.reportName)").font(.headline)
                        Text("제출인 \(filing.filerName) · DART 원문 열기").foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("dart-link-\(filing.receiptNo)")
            }
        } else if stock.filings.state == "error" {
            Card { Text("공시를 불러오지 못했습니다. 가격 자료는 그대로 확인할 수 있습니다.") }
        } else {
            Text("연결된 공시가 없습니다.").foregroundStyle(.secondary)
        }
        SectionTitle("AI가 근거 안에서 브리핑합니다")
        Button("AI 브리핑 만들기", action: requestBriefing)
            .buttonStyle(.borderedProminent)
            .tint(Color(red: 28 / 255, green: 72 / 255, blue: 184 / 255))
            .accessibilityIdentifier("briefing-button")
        Text("매수·매도 추천이나 미래 가격 예측이 아닙니다. 숫자와 공시는 출처에서 다시 확인합니다.")
            .font(.footnote).foregroundStyle(.secondary)
        if let response = briefing { BriefingView(response: response) }
    }
}

struct BriefingView: View {
    let response: BriefingResponse
    var body: some View {
        SectionTitle("AI 브리핑").accessibilityIdentifier("briefing-title")
        Card {
            Text(response.briefing.headline).font(.headline)
            VStack(alignment: .leading, spacing: 16) {
                ForEach(response.briefing.allItems) { item in
                    Text("• \(item.text)")
                        .lineSpacing(5)
                }
            }
            .padding(.top, 6)
        }
        Text("근거 출처 \(response.packet.references.count)개 · 현재 자료로 알 수 없는 것은 브리핑의 한계에서 확인합니다.")
            .font(.footnote).foregroundStyle(.secondary)
    }
}

struct PriceChart: View {
    let bars: [DailyBar]
    @State private var period: ChartPeriod = .threeMonths

    var body: some View {
        let visible = Array(bars.suffix(period.tradingDays ?? bars.count))
        let lowest = visible.map(\.low).min() ?? 0
        let highest = visible.map(\.high).max() ?? 1

        VStack(alignment: .leading, spacing: 10) {
            Picker("차트 기간", selection: $period) {
                ForEach(ChartPeriod.allCases) { value in
                    Text(value.label).tag(value)
                }
            }
            .pickerStyle(.segmented)

            HStack {
                Label("상승", systemImage: "square.fill").foregroundStyle(upColor)
                Label("하락", systemImage: "square.fill").foregroundStyle(downColor)
                Spacer()
                Text("고가 \(highest.number) · 저가 \(lowest.number)")
                    .foregroundStyle(.secondary)
            }
            .font(.caption)

            Canvas { context, size in
                guard !visible.isEmpty else { return }
                let priceHeight = size.height * 0.72
                let volumeTop = size.height * 0.78
                let volumeHeight = size.height - volumeTop
                let priceRange = max(highest - lowest, 1)
                let maxVolume = max(visible.map(\.volume).max() ?? 1, 1)
                let step = size.width / CGFloat(visible.count)
                let candleWidth = max(1, min(step * 0.68, 9))

                func priceY(_ price: Double) -> CGFloat {
                    priceHeight * CGFloat(1 - (price - lowest) / priceRange)
                }

                for (index, bar) in visible.enumerated() {
                    let x = step * (CGFloat(index) + 0.5)
                    let color = bar.close > bar.open ? upColor : (bar.close < bar.open ? downColor : .secondary)

                    var wick = Path()
                    wick.move(to: CGPoint(x: x, y: priceY(bar.high)))
                    wick.addLine(to: CGPoint(x: x, y: priceY(bar.low)))
                    context.stroke(wick, with: .color(color), lineWidth: max(1, candleWidth * 0.24))

                    let openY = priceY(bar.open)
                    let closeY = priceY(bar.close)
                    let body = CGRect(
                        x: x - candleWidth / 2,
                        y: min(openY, closeY),
                        width: candleWidth,
                        height: max(abs(closeY - openY), 1.5)
                    )
                    context.fill(Path(body), with: .color(color))

                    let volumeBarHeight = volumeHeight * CGFloat(bar.volume / maxVolume)
                    let volume = CGRect(
                        x: x - candleWidth / 2,
                        y: size.height - volumeBarHeight,
                        width: candleWidth,
                        height: volumeBarHeight
                    )
                    context.fill(Path(volume), with: .color(color.opacity(0.35)))
                }
            }
            .frame(height: 260)

            HStack {
                Text(visible.first?.date.koreanDate ?? "")
                Spacer()
                Text("거래량")
                Spacer()
                Text(visible.last?.date.koreanDate ?? "")
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        .padding(12)
        .background(.background, in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(period.label) 일봉 캔들차트와 거래량, 거래일 \(visible.count)일, 고가 \(highest.number)원, 저가 \(lowest.number)원")
    }

    private let upColor = Color(red: 198 / 255, green: 40 / 255, blue: 40 / 255)
    private let downColor = Color(red: 18 / 255, green: 86 / 255, blue: 196 / 255)
}

private enum ChartPeriod: String, CaseIterable, Identifiable {
    case oneMonth
    case threeMonths
    case oneYear

    var id: String { rawValue }
    var label: String {
        switch self {
        case .oneMonth: "1개월"
        case .threeMonths: "3개월"
        case .oneYear: "1년"
        }
    }
    var tradingDays: Int? {
        switch self {
        case .oneMonth: 22
        case .threeMonths: 66
        case .oneYear: nil
        }
    }
}
