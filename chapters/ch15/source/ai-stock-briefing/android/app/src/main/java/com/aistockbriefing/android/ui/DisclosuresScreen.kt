package com.aistockbriefing.android.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.aistockbriefing.android.model.DisclosuresResponse
import com.aistockbriefing.android.network.StockRepository
import com.aistockbriefing.android.network.toUserMessage

@Composable fun DisclosuresScreen(code: String, stockName: String) {
    var page by remember { mutableIntStateOf(1) }
    val state by produceState<UiState<DisclosuresResponse>>(UiState.Loading, code, page) {
        value = try { UiState.Success(StockRepository.getDisclosures(code, page)) } catch (e: Exception) { UiState.Error(e.toUserMessage()) }
    }
    val context = LocalContext.current
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("최근 1년 전체 공시", style = MaterialTheme.typography.headlineSmall)
        when (val current = state) {
            is UiState.Loading -> LoadingIndicator()
            is UiState.Error -> Text(current.message)
            is UiState.Success -> {
                val data = current.data
                Text("출처: ${data.source} · 조회 기간 ${formatBaseDateLabel(data.from)} ~ ${formatBaseDateLabel(data.to)} · 전체 ${data.totalCount}건", color = MaterialTheme.colorScheme.onSurfaceVariant)
                LazyColumn(Modifier.weight(1f).padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(data.items) { item -> FilingRow(item, stockName) { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(item.dartUrl))) } }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Button({ page-- }, enabled = page > 1) { Text("이전 페이지") }
                    Text("${data.pageNo} / ${data.totalPage.coerceAtLeast(1)}페이지")
                    Button({ page++ }, enabled = page < data.totalPage) { Text("다음 페이지") }
                }
            }
        }
    }
}
