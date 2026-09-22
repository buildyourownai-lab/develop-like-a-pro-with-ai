import Foundation

// src/lib/format.ts, android ui/Formatters.kt와 같은 정밀도·단위로 숫자를
// 보여준다(원/%/억원/주).
private let koreaLocale = Locale(identifier: "ko_KR")

private func groupingFormatter(maximumFractionDigits: Int = 0) -> NumberFormatter {
    let formatter = NumberFormatter()
    formatter.locale = koreaLocale
    formatter.numberStyle = .decimal
    formatter.maximumFractionDigits = maximumFractionDigits
    formatter.minimumFractionDigits = 0
    formatter.roundingMode = .halfUp
    return formatter
}

private func group(_ value: Int64, maximumFractionDigits: Int = 0) -> String {
    groupingFormatter(maximumFractionDigits: maximumFractionDigits)
        .string(from: NSNumber(value: value)) ?? "\(value)"
}

private func group(_ value: Double, maximumFractionDigits: Int) -> String {
    groupingFormatter(maximumFractionDigits: maximumFractionDigits)
        .string(from: NSNumber(value: value)) ?? "\(value)"
}

func formatPrice(_ value: Double) -> String {
    "\(group(Int64(value.rounded())))원"
}

func formatChange(_ value: Double) -> String {
    let sign = value > 0 ? "+" : ""
    return "\(sign)\(group(value, maximumFractionDigits: 3))"
}

func formatChangeRate(_ value: Double) -> String {
    let sign = value > 0 ? "+" : ""
    return "\(sign)\(String(format: "%.2f", value))%"
}

func formatTradingValue(_ value: Double) -> String {
    let eok = Int64((value / 100_000_000).rounded())
    let jo = eok / 10_000
    let remainder = eok % 10_000
    if jo == 0 { return "\(group(remainder))억원" }
    return "\(group(jo))조 \(group(remainder))억원"
}

func formatVolume(_ value: Double) -> String {
    "\(group(Int64(value.rounded())))주"
}

// 지수 값은 원(KRW) 단위 가격이 아니라 지수 포인트다 — "원"을 붙이지 않고
// 웹(page.tsx의 idx.value.toLocaleString("ko-KR"))과 같이 소수점까지 그대로
// 보여준다.
func formatIndexValue(_ value: Double) -> String {
    group(value, maximumFractionDigits: 0)
}

func formatBaseDateLabel(_ basDt: String) -> String {
    guard basDt.count >= 8 else { return basDt }
    let chars = Array(basDt)
    let y = String(chars[0..<4])
    let m = String(chars[4..<6])
    let d = String(chars[6..<8])
    return "\(y).\(m).\(d)"
}

func directionSymbol(_ value: Double) -> String {
    if value > 0 { return "▲" }
    if value < 0 { return "▼" }
    return "－"
}

func directionWord(_ value: Double) -> String {
    if value > 0 { return "상승" }
    if value < 0 { return "하락" }
    return "보합"
}

// rate-limited 재시도 시각 표시 — 웹 format.ts의 formatDateTimeLabel과 같이
// ISO 문자열을 Asia/Seoul 기준 "yyyy-MM-dd HH:mm"로 정확히 변환한다(Android는
// 문자열을 자르기만 했지만, 서버가 UTC로 보내는 ISO 문자열을 그대로 자르면
// 실제 한국 시각과 달라질 수 있어 iOS는 더 정확한 방식을 따른다).
func formatDateTimeLabel(_ iso: String) -> String {
    let isoFormatter = ISO8601DateFormatter()
    isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    var date = isoFormatter.date(from: iso)
    if date == nil {
        isoFormatter.formatOptions = [.withInternetDateTime]
        date = isoFormatter.date(from: iso)
    }
    guard let date else { return iso }

    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Seoul") ?? TimeZone(identifier: "GMT")!
    let components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
    guard let year = components.year,
          let month = components.month,
          let day = components.day,
          let hour = components.hour,
          let minute = components.minute else { return iso }
    return String(format: "%04d-%02d-%02d %02d:%02d", year, month, day, hour, minute)
}
