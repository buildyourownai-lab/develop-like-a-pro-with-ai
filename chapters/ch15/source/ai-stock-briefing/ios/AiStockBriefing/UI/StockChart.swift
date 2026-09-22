import SwiftUI

enum ChartRangeOption: Int, CaseIterable, Identifiable {
    case oneMonth
    case threeMonths
    case oneYear

    var id: Int { rawValue }

    var days: Int {
        switch self {
        case .oneMonth: return 30
        case .threeMonths: return 90
        case .oneYear: return 365
        }
    }

    var label: String {
        switch self {
        case .oneMonth: return "1개월"
        case .threeMonths: return "3개월"
        case .oneYear: return "1년"
        }
    }
}

// basDt("yyyyMMdd")를 날짜 비교가 가능한 정수로만 바꾼다 — 문자열 사전순
// 비교와 실제 날짜 앞뒤 순서가 이 형식에서는 같으므로, 달력 계산 없이도
// 구간(cutoff) 비교에 안전하게 쓸 수 있다.
private func basDtValue(_ basDt: String) -> Int? {
    Int(basDt)
}

// 서버가 이미 받아온 최근 1년치 일봉(bars) 하나로 구간(1개월/3개월/1년)만
// 클라이언트에서 나눠 보여준다 — 구간마다 서버를 다시 부르지 않는다(웹의
// StockChart.tsx도 하나의 1년치 자료를 받아 화면에서만 확대/축소한다).
func filterByRange(_ bars: [DailyBar], range: ChartRangeOption) -> [DailyBar] {
    guard let last = bars.last, let lastValue = basDtValue(last.date) else { return bars }
    // yyyyMMdd 정수에서 대략 range.days만큼 이전인 날짜를 구하려면 실제
    // 달력 계산이 필요하다 — Date로 변환해 날짜 빼기를 한 뒤 다시 정수로
    // 바꾼다.
    guard let lastDate = parseBasDt(last.date) else { return bars }
    let cutoffDate = Calendar(identifier: .gregorian).date(byAdding: .day, value: -range.days, to: lastDate)
    guard let cutoffDate else { return bars }
    let cutoffValue = Int(basDtString(from: cutoffDate)) ?? lastValue
    return bars.filter { bar in
        guard let value = basDtValue(bar.date) else { return false }
        return value >= cutoffValue
    }
}

private func parseBasDt(_ basDt: String) -> Date? {
    guard basDt.count == 8, let value = Int(basDt) else { return nil }
    let year = value / 10000
    let month = (value / 100) % 100
    let day = value % 100
    var components = DateComponents()
    components.year = year
    components.month = month
    components.day = day
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
    return calendar.date(from: components)
}

private func basDtString(from date: Date) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Seoul") ?? .current
    let components = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d%02d%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
}

struct StockChart: View {
    let bars: [DailyBar]

    @State private var range: ChartRangeOption = .oneYear
    @Environment(\.colorScheme) private var colorScheme

    private var visibleBars: [DailyBar] { filterByRange(bars, range: range) }
    private var highest: Double { visibleBars.map(\.high).max() ?? 0 }
    private var lowest: Double { visibleBars.map(\.low).min() ?? 0 }
    private var upColor: Color { colorScheme == .dark ? .riseColorDark : .riseColorLight }
    private var downColor: Color { colorScheme == .dark ? .fallColorDark : .fallColorLight }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ForEach(ChartRangeOption.allCases) { option in
                    Button(action: { range = option }) {
                        Text(option.label)
                            .font(.footnote)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(range == option ? Color.accentColorLight.opacity(0.15) : Color.clear)
                            .overlay(
                                Capsule().stroke(range == option ? Color.accentColorLight : .gray, lineWidth: 1)
                            )
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("chartRange-\(option.label)")
                }
            }

            if visibleBars.isEmpty {
                Text("표시할 시세가 없습니다.")
            } else {
                HStack {
                    Label("상승", systemImage: "square.fill").foregroundColor(upColor)
                    Label("하락", systemImage: "square.fill").foregroundColor(downColor)
                    Spacer()
                    Text("고가 \(formatPrice(highest)) · 저가 \(formatPrice(lowest))")
                        .foregroundColor(.secondary)
                }
                .font(.caption)

                CandleChart(bars: visibleBars)
                    .frame(height: 220)
            }
        }
    }
}

// 웹(StockChart.tsx)과 같은 유형(A=정기공시, B=주요사항보고) 색·모양이다.
private struct CandleChart: View {
    let bars: [DailyBar]
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.appColors) private var colors

    var body: some View {
        let dark = colorScheme == .dark
        let upColor = dark ? Color.riseColorDark : Color.riseColorLight
        let downColor = dark ? Color.fallColorDark : Color.fallColorLight
        let flatColor = Color(hex: 0x757575)
        let backgroundColor = colors.background

        Canvas { context, size in
            guard !bars.isEmpty else { return }
            let maxPrice = bars.map(\.high).max() ?? 0
            let minPrice = bars.map(\.low).min() ?? 0
            let priceRange = (maxPrice - minPrice) <= 0 ? 1.0 : (maxPrice - minPrice)
            let maxVolume = max(bars.map(\.volume).max() ?? 1, 1)

            let priceAreaHeight = size.height * 0.75
            let volumeAreaTop = priceAreaHeight + 12
            let volumeAreaHeight = size.height - volumeAreaTop

            let slotWidth = size.width / CGFloat(bars.count)
            let candleWidth = max(slotWidth * 0.6, 1)

            func yFor(_ price: Double) -> CGFloat {
                priceAreaHeight - CGFloat((price - minPrice) / priceRange) * priceAreaHeight
            }

            for (i, bar) in bars.enumerated() {
                let centerX = slotWidth * CGFloat(i) + slotWidth / 2
                let color: Color
                if bar.close > bar.open {
                    color = upColor
                } else if bar.close < bar.open {
                    color = downColor
                } else {
                    color = flatColor
                }

                // 고가-저가 심지
                var wickPath = Path()
                wickPath.move(to: CGPoint(x: centerX, y: yFor(bar.high)))
                wickPath.addLine(to: CGPoint(x: centerX, y: yFor(bar.low)))
                context.stroke(wickPath, with: .color(color), lineWidth: 1.5)

                // 시가-종가 몸통 — 상승은 배경색으로 채운 테두리만(빈 캔들),
                // 하락은 채워서(웹 StockChart.tsx와 같은 규칙) 색 없이도
                // 모양으로 구분되게 한다.
                let bodyTop = yFor(max(bar.open, bar.close))
                let bodyBottom = yFor(min(bar.open, bar.close))
                let bodyHeight = max(bodyBottom - bodyTop, 1)
                let bodyRect = CGRect(
                    x: centerX - candleWidth / 2,
                    y: bodyTop,
                    width: candleWidth,
                    height: bodyHeight
                )
                if bar.close > bar.open {
                    context.fill(Path(bodyRect), with: .color(backgroundColor))
                    context.stroke(Path(bodyRect), with: .color(color), lineWidth: 1.5)
                } else {
                    context.fill(Path(bodyRect), with: .color(color))
                }

                // 거래량
                let volHeight = CGFloat(bar.volume / maxVolume) * volumeAreaHeight
                let volRect = CGRect(
                    x: centerX - candleWidth / 2,
                    y: size.height - volHeight,
                    width: candleWidth,
                    height: volHeight
                )
                context.fill(Path(volRect), with: .color(color.opacity(0.5)))

            }
        }
    }
}
