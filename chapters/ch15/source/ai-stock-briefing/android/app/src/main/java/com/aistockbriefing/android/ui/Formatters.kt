package com.aistockbriefing.android.ui

import java.text.NumberFormat
import java.util.Locale
import kotlin.math.roundToLong

// src/lib/format.ts와 같은 정밀도·단위로 숫자를 보여준다(원/%/억원/주).
private val grouping = NumberFormat.getNumberInstance(Locale.KOREA)

fun formatPrice(value: Double): String = "${grouping.format(value.roundToLong())}원"

fun formatChange(value: Double): String {
    val sign = if (value > 0) "+" else ""
    val formatter = NumberFormat.getNumberInstance(Locale.KOREA).apply { maximumFractionDigits = 3 }
    return "$sign${formatter.format(value)}"
}

fun formatChangeRate(value: Double): String {
    val sign = if (value > 0) "+" else ""
    return "$sign${String.format(Locale.KOREA, "%.2f", value)}%"
}

fun formatTradingValue(value: Double): String {
    val eok = (value / 100_000_000).roundToLong()
    val jo = eok / 10_000
    val remainder = eok % 10_000
    return if (jo == 0L) "${grouping.format(remainder)}억원"
    else "${grouping.format(jo)}조 ${grouping.format(remainder)}억원"
}

fun formatVolume(value: Double): String = "${grouping.format(value.roundToLong())}주"

// 지수 값은 원(KRW) 단위 가격이 아니라 지수 포인트다 — "원"을 붙이지 않고
// 웹(page.tsx의 idx.value.toLocaleString("ko-KR"))과 같이 소수점까지 그대로
// 보여준다.
fun formatIndexValue(value: Double): String {
    val formatter = NumberFormat.getNumberInstance(Locale.KOREA).apply { maximumFractionDigits = 0 }
    return formatter.format(value)
}

fun formatBaseDateLabel(basDt: String): String {
    if (basDt.length < 8) return basDt
    val y = basDt.substring(0, 4)
    val m = basDt.substring(4, 6)
    val d = basDt.substring(6, 8)
    return "$y.$m.$d"
}

fun directionSymbol(value: Double): String = when {
    value > 0 -> "▲"
    value < 0 -> "▼"
    else -> "－"
}
