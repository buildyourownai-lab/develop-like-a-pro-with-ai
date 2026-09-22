package com.aistockbriefing.android

import com.aistockbriefing.android.ui.formatBaseDateLabel
import com.aistockbriefing.android.ui.formatChange
import com.aistockbriefing.android.ui.formatChangeRate
import com.aistockbriefing.android.ui.formatIndexValue
import com.aistockbriefing.android.ui.formatPrice
import com.aistockbriefing.android.ui.formatTradingValue
import com.aistockbriefing.android.ui.formatVolume
import org.junit.Assert.assertEquals
import org.junit.Test

// 서버(src/lib/format.ts)와 같은 정밀도·단위로 표시하는지 확인한다.
class FormattersTest {

    @Test
    fun `가격은 천단위 구분과 원 단위를 붙인다`() {
        assertEquals("1,653,000원", formatPrice(1653000.0))
    }

    @Test
    fun `등락은 양수일 때 플러스 기호를 붙인다`() {
        assertEquals("+123", formatChange(123.0))
        assertEquals("-77,000", formatChange(-77000.0))
    }

    @Test
    fun `등락률은 소수 둘째 자리까지 보여준다`() {
        assertEquals("+1.23%", formatChangeRate(1.234))
        assertEquals("-4.45%", formatChangeRate(-4.45))
    }

    @Test
    fun `거래대금은 억원 단위로 반올림한다`() {
        assertEquals("5조 9,842억원", formatTradingValue(5_984_200_000_000.0))
    }

    @Test
    fun `거래량은 주 단위를 붙인다`() {
        assertEquals("3,531,892주", formatVolume(3531892.0))
    }

    @Test
    fun `기준일은 최종 앱과 같은 yyyy점MM점dd 형태로 보여준다`() {
        assertEquals("2026.08.28", formatBaseDateLabel("20260828"))
    }

    @Test
    fun `지수 값은 최종 앱처럼 원 단위 없이 정수로 보여준다`() {
        assertEquals("6,789", formatIndexValue(6788.88))
        assertEquals("838", formatIndexValue(838.41))
    }
}
