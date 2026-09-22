package com.aistockbriefing.android.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

// 자료를 가져오는 중인 상태를 오류·빈 결과와 구분해 보여준다 — 모든 화면이
// 같은 모양으로 보여주도록 여기 하나만 둔다.
@Composable
fun LoadingIndicator(modifier: Modifier = Modifier, label: String = "불러오는 중입니다…") {
    Column(modifier = modifier) {
        CircularProgressIndicator()
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}
