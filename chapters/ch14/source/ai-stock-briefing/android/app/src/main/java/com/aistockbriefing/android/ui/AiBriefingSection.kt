package com.aistockbriefing.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aistockbriefing.android.model.BriefingResponse
import com.aistockbriefing.android.network.StockRepository
import com.aistockbriefing.android.network.toUserMessage
import kotlinx.coroutines.launch

@Composable fun AiBriefingSection(code: String) {
    var state by remember(code) { mutableStateOf<UiState<BriefingResponse>?>(null) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxWidth()) {
        Text("AI가 근거 안에서 브리핑합니다", style = MaterialTheme.typography.titleMedium)
        Text("매수·매도 추천이나 미래 가격 예측이 아닙니다. 숫자와 공시는 출처에서 다시 확인합니다.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        when (val current = state) {
            null -> Button({ state = UiState.Loading; scope.launch { state = try { UiState.Success(StockRepository.postBriefing(code)) } catch (e: Exception) { UiState.Error(e.toUserMessage()) } } }) { Text("AI 브리핑 만들기") }
            is UiState.Loading -> LoadingIndicator(label = "브리핑 만드는 중...")
            is UiState.Error -> Text(current.message)
            is UiState.Success -> {
                Text("AI 브리핑", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
                ListCard(Modifier.fillMaxWidth()) {
                    Text(current.data.briefing.headline, fontWeight = FontWeight.Bold)
                    current.data.briefing.allItems.forEach { Text("• ${it.text}", modifier = Modifier.padding(top = 8.dp)) }
                }
                Text("근거 출처 ${current.data.packet.references.size}개 · 현재 자료로 알 수 없는 것은 브리핑의 한계에서 확인합니다.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
