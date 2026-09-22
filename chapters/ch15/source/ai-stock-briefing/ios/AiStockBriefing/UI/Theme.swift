import SwiftUI

// 웹(src/app/globals.css, StockChart.tsx)과 같은 인상을 주기 위해 SwiftUI
// 기본 accentColor를 쓰지 않고, 웹의 흑백 배경/글자 색과 상승(빨강)·
// 하락(파랑) 색을 그대로 옮긴다. 시스템 다크모드를 자동으로 따른다
// (Android isSystemInDarkTheme(), 웹 prefers-color-scheme와 같은 개념).
extension Color {
    static let appForegroundLight = Color(hex: 0x171717)
    static let appBackgroundLight = Color(hex: 0xFFFFFF)
    static let appSurfaceVariantLight = Color(hex: 0xF4F6FA)
    static let appOnSurfaceVariantLight = Color(hex: 0x555555)
    static let appOutlineLight = Color(hex: 0xCCCCCC)
    static let appOutlineVariantLight = Color(hex: 0xDDDDDD)

    static let appForegroundDark = Color(hex: 0xEDEDED)
    static let appBackgroundDark = Color(hex: 0x0A0A0A)
    static let appSurfaceVariantDark = Color(hex: 0x1F1F1F)
    static let appOnSurfaceVariantDark = Color(hex: 0xA0A0A0)
    static let appOutlineDark = Color(hex: 0x444444)
    static let appOutlineVariantDark = Color(hex: 0x333333)

    // StockChart.tsx의 상승(빨강)·하락(파랑) 색과 같은 값이다 — 이 앱 전체가
    // 이 두 값 하나로 상승·하락을 나타낸다.
    static let riseColorLight = Color(hex: 0xE34948)
    static let fallColorLight = Color(hex: 0x2A78D6)
    static let riseColorDark = Color(hex: 0xE66767)
    static let fallColorDark = Color(hex: 0x3987E5)

    // 누를 수 있는 곳(목록 행, "전체 보기"·"DART 원문 열기" 같은 링크형 글자)에
    // 앱 전체에서 하나로만 쓰는 강조색.
    static let accentColorLight = Color(hex: 0x0B57D0)
    static let accentColorDark = Color(hex: 0x8AB4F8)

    // 경고·안내문에만 쓰는 색(기준일 다름, 한도 도달 등) — 라이트/다크 공통.
    static let noticeColor = Color(hex: 0xA15C00)

    init(hex: UInt32) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8) & 0xFF) / 255.0
        let b = Double(hex & 0xFF) / 255.0
        self.init(red: r, green: g, blue: b)
    }
}

struct AppColorScheme {
    let isDark: Bool

    var foreground: Color { isDark ? .appForegroundDark : .appForegroundLight }
    var background: Color { isDark ? .appBackgroundDark : .appBackgroundLight }
    var surfaceVariant: Color { isDark ? .appSurfaceVariantDark : .appSurfaceVariantLight }
    var onSurfaceVariant: Color { isDark ? .appOnSurfaceVariantDark : .appOnSurfaceVariantLight }
    var outline: Color { isDark ? .appOutlineDark : .appOutlineLight }
    var outlineVariant: Color { isDark ? .appOutlineVariantDark : .appOutlineVariantLight }
    var accent: Color { isDark ? .accentColorDark : .accentColorLight }

    func direction(_ value: Double) -> Color {
        if value > 0 { return isDark ? .riseColorDark : .riseColorLight }
        if value < 0 { return isDark ? .fallColorDark : .fallColorLight }
        return foreground
    }
}

private struct AppColorSchemeKey: EnvironmentKey {
    static let defaultValue = AppColorScheme(isDark: false)
}

extension EnvironmentValues {
    var appColors: AppColorScheme {
        get { self[AppColorSchemeKey.self] }
        set { self[AppColorSchemeKey.self] = newValue }
    }
}

// 화면 루트에서 시스템 colorScheme을 읽어 AppColorScheme을 채워 넣는다.
struct AppThemeModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .environment(\.appColors, AppColorScheme(isDark: colorScheme == .dark))
            .background(AppColorScheme(isDark: colorScheme == .dark).background)
            .foregroundColor(AppColorScheme(isDark: colorScheme == .dark).foreground)
    }
}

extension View {
    func appTheme() -> some View {
        modifier(AppThemeModifier())
    }
}
