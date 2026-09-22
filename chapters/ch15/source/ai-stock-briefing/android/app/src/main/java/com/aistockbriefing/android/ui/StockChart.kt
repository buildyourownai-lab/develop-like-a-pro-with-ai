package com.aistockbriefing.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.aistockbriefing.android.model.DailyBar
import com.aistockbriefing.android.ui.theme.FallColorDark
import com.aistockbriefing.android.ui.theme.FallColorLight
import com.aistockbriefing.android.ui.theme.RiseColorDark
import com.aistockbriefing.android.ui.theme.RiseColorLight
import java.time.LocalDate
import java.time.format.DateTimeFormatter

private val BAS_DT_FORMAT: DateTimeFormatter = DateTimeFormatter.BASIC_ISO_DATE

enum class ChartRange(val days: Long, val label: String) {
    ONE_MONTH(30, "1개월"),
    THREE_MONTHS(90, "3개월"),
    ONE_YEAR(365, "1년"),
}

// 서버가 이미 받아온 최근 1년치 일봉(bars) 하나로 구간(1개월/3개월/1년)만
// 클라이언트에서 나눠 보여준다 — 구간마다 서버를 다시 부르지 않는다(웹의
// StockChart.tsx도 하나의 1년치 자료를 받아 화면에서만 확대/축소한다).
private fun filterByRange(bars: List<DailyBar>, range: ChartRange): List<DailyBar> {
    if (bars.isEmpty()) return bars
    val lastDate = runCatching { LocalDate.parse(bars.last().basDt, BAS_DT_FORMAT) }.getOrNull()
        ?: return bars
    val cutoff = lastDate.minusDays(range.days)
    return bars.filter { bar ->
        val date = runCatching { LocalDate.parse(bar.basDt, BAS_DT_FORMAT) }.getOrNull()
        date != null && !date.isBefore(cutoff)
    }
}

@Composable
fun StockChart(
    bars: List<DailyBar>,
    modifier: Modifier = Modifier,
) {
    var range by remember { mutableStateOf(ChartRange.ONE_YEAR) }
    val visibleBars = remember(bars, range) { filterByRange(bars, range) }

    Column(modifier = modifier) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 8.dp)) {
            ChartRange.entries.forEach { r ->
                FilterChip(
                    selected = range == r,
                    onClick = { range = r },
                    label = { Text(r.label) },
                )
            }
        }

        if (visibleBars.isEmpty()) {
            Text("표시할 시세가 없습니다.")
            return@Column
        }

        Text(
            "빈 캔들(테두리만) = 상승 · 채워진 캔들 = 하락. 거래량 막대도 그날이 상승이면 빨강, 하락이면 파랑입니다.",
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(bottom = 4.dp),
        )

        CandleChart(visibleBars, modifier = Modifier.fillMaxWidth().height(220.dp))
    }
}

@Composable
private fun CandleChart(
    bars: List<DailyBar>,
    modifier: Modifier = Modifier,
) {
    val dark = androidx.compose.foundation.isSystemInDarkTheme()
    val upColor = if (dark) RiseColorDark else RiseColorLight
    val downColor = if (dark) FallColorDark else FallColorLight
    val flatColor = Color(0xFF757575)
    val backgroundColor = MaterialTheme.colorScheme.background

    Box(modifier = modifier) {
        Canvas(modifier = Modifier.fillMaxWidth().height(220.dp)) {
            val maxPrice = bars.maxOf { it.high }
            val minPrice = bars.minOf { it.low }
            val priceRange = (maxPrice - minPrice).let { if (it <= 0.0) 1.0 else it }

            val maxVolume = bars.maxOf { it.volume }.let { if (it <= 0.0) 1.0 else it }

            val priceAreaHeight = size.height * 0.75f
            val volumeAreaTop = priceAreaHeight + 12f
            val volumeAreaHeight = size.height - volumeAreaTop

            val slotWidth = size.width / bars.size
            val candleWidth = (slotWidth * 0.6f).coerceAtLeast(1f)

            bars.forEachIndexed { i, bar ->
                val centerX = slotWidth * i + slotWidth / 2f
                val color = when {
                    bar.close > bar.open -> upColor
                    bar.close < bar.open -> downColor
                    else -> flatColor
                }

                fun yFor(price: Double): Float =
                    priceAreaHeight - ((price - minPrice) / priceRange * priceAreaHeight).toFloat()

                // 고가-저가 심지
                drawLine(
                    color = color,
                    start = Offset(centerX, yFor(bar.high)),
                    end = Offset(centerX, yFor(bar.low)),
                    strokeWidth = 1.5f,
                )
                // 시가-종가 몸통 — 상승은 배경색으로 채운 테두리만(빈 캔들),
                // 하락은 채워서(웹 StockChart.tsx와 같은 규칙) 색 없이도
                // 모양으로 구분되게 한다. 테두리만 그리면(Stroke) 캔들이
                // 좁을 때 안쪽이 남지 않아 그냥 채운 것처럼 보이므로, 먼저
                // 배경색으로 채우고 그 위에 테두리를 그린다.
                val bodyTop = yFor(maxOf(bar.open, bar.close))
                val bodyBottom = yFor(minOf(bar.open, bar.close))
                val bodySize = androidx.compose.ui.geometry.Size(
                    candleWidth,
                    (bodyBottom - bodyTop).coerceAtLeast(1f),
                )
                val bodyTopLeft = Offset(centerX - candleWidth / 2f, bodyTop)
                if (bar.close > bar.open) {
                    drawRect(color = backgroundColor, topLeft = bodyTopLeft, size = bodySize)
                    drawRect(
                        color = color,
                        topLeft = bodyTopLeft,
                        size = bodySize,
                        style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1.5f),
                    )
                } else {
                    drawRect(color = color, topLeft = bodyTopLeft, size = bodySize)
                }

                // 거래량
                val volHeight = (bar.volume / maxVolume * volumeAreaHeight).toFloat()
                drawRect(
                    color = color.copy(alpha = 0.5f),
                    topLeft = Offset(centerX - candleWidth / 2f, size.height - volHeight),
                    size = androidx.compose.ui.geometry.Size(candleWidth, volHeight),
                )

            }
        }
    }
}
