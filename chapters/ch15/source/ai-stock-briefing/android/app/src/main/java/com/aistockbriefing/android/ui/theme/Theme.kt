package com.aistockbriefing.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// 웹(src/app/globals.css, StockChart.tsx)과 같은 인상을 주기 위해 Compose
// 기본값(연보라색 계열)을 쓰지 않고, 웹의 흑백 배경/글자 색과 상승(빨강)·
// 하락(파랑) 색을 그대로 옮긴다.
private val LightForeground = Color(0xFF171717)
private val LightBackground = Color(0xFFF5F7FB)
private val LightSurface = Color(0xFFFFFFFF)
private val LightSurfaceVariant = Color(0xFFEDF2FF)
private val LightOnSurfaceVariant = Color(0xFF667085)
private val LightOutline = Color(0xFFD6DCE8)
private val LightOutlineVariant = Color(0xFFE0E5EE)

private val DarkForeground = Color(0xFFEDEDED)
private val DarkBackground = Color(0xFF0A0A0A)
private val DarkSurfaceVariant = Color(0xFF1F1F1F)
private val DarkOnSurfaceVariant = Color(0xFFA0A0A0)
private val DarkOutline = Color(0xFF444444)
private val DarkOutlineVariant = Color(0xFF333333)

// StockChart.tsx의 상승(빨강)·하락(파랑) 색과 같은 값이다 — 이 앱 전체가
// 이 두 값 하나로 상승·하락을 나타낸다.
val RiseColorLight = Color(0xFFE34948)
val FallColorLight = Color(0xFF2A78D6)
val RiseColorDark = Color(0xFFE66767)
val FallColorDark = Color(0xFF3987E5)

// 누를 수 있는 곳(목록 행, "전체 보기"·"DART 원문 열기" 같은 링크형 글자)에
// 앱 전체에서 하나로만 쓰는 강조색 — 상승·하락 색과 헷갈리지 않도록 파랑
// 계열 중 상승·하락 파랑(FallColor)과는 다른 톤을 쓴다.
val AccentColorLight = Color(0xFF2453C5)
val AccentColorDark = Color(0xFF8AB4F8)

// page.module.css .notice(#a15c00)와 같은, 경고·안내문에만 쓰는 색 —
// 기준일·출처 같은 보조 정보(회색)와 구분한다. 웹은 다크 모드에서도 같은
// 값을 쓰므로 여기서도 하나만 둔다.
val NoticeColor = Color(0xFFA15C00)

private val LightColors = lightColorScheme(
    primary = AccentColorLight,
    onPrimary = Color.White,
    primaryContainer = LightSurfaceVariant,
    onPrimaryContainer = LightForeground,
    secondary = LightOnSurfaceVariant,
    onSecondary = LightBackground,
    secondaryContainer = LightSurfaceVariant,
    onSecondaryContainer = LightForeground,
    background = LightBackground,
    onBackground = LightForeground,
    surface = LightSurface,
    onSurface = LightForeground,
    surfaceVariant = LightSurfaceVariant,
    onSurfaceVariant = LightOnSurfaceVariant,
    outline = LightOutline,
    outlineVariant = LightOutlineVariant,
)

private val DarkColors = darkColorScheme(
    primary = DarkForeground,
    onPrimary = DarkBackground,
    primaryContainer = DarkSurfaceVariant,
    onPrimaryContainer = DarkForeground,
    secondary = DarkOnSurfaceVariant,
    onSecondary = DarkBackground,
    secondaryContainer = DarkSurfaceVariant,
    onSecondaryContainer = DarkForeground,
    background = DarkBackground,
    onBackground = DarkForeground,
    surface = DarkBackground,
    onSurface = DarkForeground,
    surfaceVariant = DarkSurfaceVariant,
    onSurfaceVariant = DarkOnSurfaceVariant,
    outline = DarkOutline,
    outlineVariant = DarkOutlineVariant,
)

@Composable
fun AiStockBriefingTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) DarkColors else LightColors
    MaterialTheme(colorScheme = colors, content = content)
}

// 상승은 빨강, 하락은 파랑 — 웹과 같은 기준을 시장/검색/종목 상세/공시/AI
// 브리핑 화면 전체에서 하나로 쓴다. 0(보합)은 상승·하락으로 잘못 읽히지
// 않도록 색을 칠하지 않고 본문 글자색을 그대로 쓴다.
@Composable
fun directionColor(value: Double): Color {
    val dark = isSystemInDarkTheme()
    return when {
        value > 0 -> if (dark) RiseColorDark else RiseColorLight
        value < 0 -> if (dark) FallColorDark else FallColorLight
        else -> MaterialTheme.colorScheme.onBackground
    }
}

@Composable
fun accentColor(): Color = if (isSystemInDarkTheme()) AccentColorDark else AccentColorLight
