package com.aistockbriefing.android.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.style.TextDecoration
import com.aistockbriefing.android.ui.theme.accentColor

// OpenDART 제출인(flr_nm)은 회사명일 수도, 임원·주요주주 같은 개인 이름일
// 수도 있다. 웹 화면과 같은 형식으로 받은 값을 그대로 보여준다.
fun submitterLabel(submitter: String, companyName: String): String {
    val s = submitter.trim()
    return if (s.isEmpty()) "제출인: ${companyName.trim()}" else "제출인: $s"
}

// 공시 한 건을 누르면 DART 원문이 열린다는 것을 화면에서 알 수 있게
// 보여주는 표시다 — 최근 공시·전체 공시·AI 브리핑 공시 목록에서 모두
// 같은 문구를 쓴다.
@Composable
fun DartOriginalLinkLabel() {
    Text(
        "DART 원문 열기",
        style = MaterialTheme.typography.bodySmall,
        color = accentColor(),
        textDecoration = TextDecoration.Underline,
    )
}
