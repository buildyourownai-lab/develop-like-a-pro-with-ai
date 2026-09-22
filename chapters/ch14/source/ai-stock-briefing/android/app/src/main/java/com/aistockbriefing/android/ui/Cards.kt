package com.aistockbriefing.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aistockbriefing.android.ui.theme.accentColor

// 웹의 카드형 테두리(indexCard·detailGrid div 등, 흰 배경 + 1px 테두리 +
// 둥근 모서리)와 같은 인상을 주는 공통 카드. 시장·검색·공시 화면이 모두
// 이 카드 하나를 함께 써서, 목록이 글자만 줄줄이 나오지 않게 한다.
@Composable
fun ListCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val base = if (onClick != null) modifier.clickable(onClick = onClick) else modifier
    Surface(
        modifier = base,
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        shadowElevation = 1.dp,
    ) {
        Column(modifier = Modifier.padding(14.dp), content = content)
    }
}

@Composable
fun AppHeaderWithSearch(
    query: String,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    statusMessage: String?,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            "국내 주식 한눈에",
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.ExtraBold,
        )
        Row(modifier = Modifier.fillMaxWidth().padding(top = 20.dp)) {
            OutlinedTextField(
                value = query,
                onValueChange = onQueryChange,
                modifier = Modifier.weight(1f).semantics { contentDescription = "종목 검색어" },
                placeholder = { Text("종목명 또는 종목코드") },
                singleLine = true,
                shape = RoundedCornerShape(16.dp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { onSearch() }),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = MaterialTheme.colorScheme.surface,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                ),
            )
            Button(
                onClick = onSearch,
                modifier = Modifier.padding(start = 8.dp).width(76.dp).semantics {
                    contentDescription = "종목 검색"
                },
                shape = RoundedCornerShape(16.dp),
            ) {
                Text("검색", fontWeight = FontWeight.Bold)
            }
        }
        if (statusMessage != null) {
            Text(
                statusMessage,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 14.dp, bottom = 22.dp),
            )
        }
    }
}

// 웹의 <h2> 섹션 제목과 같은 자리에, 같은 문구로 쓰는 공통 제목.
@Composable
fun SectionHeading(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = modifier)
}

// 누르면 다른 화면으로 이동한다는 것을 색만이 아니라 모양(">")으로도 알려
// 주는 공통 표시 — 카드 오른쪽 끝에 둔다.
@Composable
fun NavigationChevron(modifier: Modifier = Modifier) {
    Text(">", color = accentColor(), style = MaterialTheme.typography.titleMedium, modifier = modifier)
}
