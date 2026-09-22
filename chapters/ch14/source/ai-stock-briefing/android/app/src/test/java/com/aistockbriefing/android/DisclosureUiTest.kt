package com.aistockbriefing.android

import com.aistockbriefing.android.ui.submitterLabel
import org.junit.Assert.assertEquals
import org.junit.Test

// 공시 제출인을 웹 화면과 같은 형식으로 보여주는지 확인한다.
class DisclosureUiTest {

    @Test
    fun `회사가 제출한 공시는 회사명을 그대로 보여준다`() {
        assertEquals("제출인: SK하이닉스", submitterLabel("SK하이닉스", "SK하이닉스"))
    }

    @Test
    fun `임원이 제출한 공시는 제출인을 그대로 보여준다`() {
        assertEquals("제출인: 홍길동", submitterLabel("홍길동", "SK하이닉스"))
    }

    @Test
    fun `제출인이 비어 있으면 회사명으로 채운다`() {
        assertEquals("제출인: SK하이닉스", submitterLabel("  ", "SK하이닉스"))
    }
}
