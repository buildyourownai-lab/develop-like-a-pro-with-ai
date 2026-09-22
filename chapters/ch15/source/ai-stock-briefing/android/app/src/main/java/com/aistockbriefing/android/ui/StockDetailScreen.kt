package com.aistockbriefing.android.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.aistockbriefing.android.model.DisclosureItem
import com.aistockbriefing.android.model.StockDetail
import com.aistockbriefing.android.network.StockRepository
import com.aistockbriefing.android.network.toUserMessage
import com.aistockbriefing.android.ui.theme.accentColor
import com.aistockbriefing.android.ui.theme.directionColor

@Composable fun StockDetailScreen(navController: NavHostController, code: String) {
    val state by produceState<UiState<StockDetail>>(UiState.Loading, code) {
        value = try { UiState.Success(StockRepository.getStockDetail(code)) } catch (e: Exception) { UiState.Error(e.toUserMessage()) }
    }
    var query by remember(code) { mutableStateOf(code) }
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current
    fun search() { if (query.isNotBlank()) { keyboard?.hide(); focus.clearFocus(); navController.navigate("search/${Uri.encode(query.trim())}") } }
    Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState())) {
        AppHeaderWithSearch(query, { query = it }, { search() }, if (state is UiState.Loading) "데이터를 불러오는 중입니다." else null)
        when (val current = state) {
            is UiState.Loading -> LoadingIndicator()
            is UiState.Error -> Text(current.message)
            is UiState.Success -> StockDetailContent(navController, current.data)
        }
    }
}

@Composable private fun StockDetailContent(navController: NavHostController, stock: StockDetail) {
    val quote = stock.quote
    val context = LocalContext.current
    Text("${quote.name} ${quote.code}", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
    ListCard(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Text(formatPrice(quote.close), style = MaterialTheme.typography.headlineMedium)
        Text("${formatChange(quote.diff)} · ${formatChangeRate(quote.changeRate)}", color = directionColor(quote.changeRate), fontWeight = FontWeight.Bold)
        Text("기준일 ${formatBaseDateLabel(quote.baseDate)}", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    ListCard(Modifier.fillMaxWidth().padding(top = 10.dp)) {
        Text("가격과 거래", fontWeight = FontWeight.Bold)
        Text("시가 ${formatPrice(quote.open)} · 고가 ${formatPrice(quote.high)}")
        Text("저가 ${formatPrice(quote.low)} · 거래량 ${formatVolume(quote.volume)}")
    }
    HorizontalDivider(Modifier.padding(vertical = 16.dp))
    Text("최근 1년 주가 흐름", style = MaterialTheme.typography.titleMedium)
    if (stock.bars.isNotEmpty()) Text("${formatBaseDateLabel(stock.bars.first().basDt)} ~ ${formatBaseDateLabel(stock.bars.last().basDt)} · 제공 거래일 ${stock.bars.size}일", color = MaterialTheme.colorScheme.onSurfaceVariant)
    StockChart(stock.bars, Modifier.padding(top = 8.dp))
    HorizontalDivider(Modifier.padding(vertical = 16.dp))
    Text("이 회사 관련 공시", style = MaterialTheme.typography.titleMedium)
    when (stock.filings.state) {
        "ready" -> {
            Text("최근 1년 접수 공시 ${stock.filings.totalCount}건 · DART 원문이 최종 근거입니다.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                stock.filings.recent.forEach { item -> FilingRow(item, quote.name) { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(item.dartUrl))) } }
            }
            Row(Modifier.padding(top = 8.dp).clickable { navController.navigate("stock/${quote.code}/disclosures/${Uri.encode(quote.name)}") }) {
                Text("전체 공시 ${stock.filings.totalCount}건 보기", color = accentColor()); NavigationChevron(Modifier.padding(start = 4.dp))
            }
        }
        "error" -> ListCard { Text("공시를 불러오지 못했습니다. 가격 자료는 그대로 확인할 수 있습니다.") }
        else -> Text("연결된 공시가 없습니다.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    HorizontalDivider(Modifier.padding(vertical = 16.dp))
    AiBriefingSection(quote.code)
}

@Composable internal fun FilingRow(item: DisclosureItem, companyName: String, onClick: () -> Unit) {
    ListCard(Modifier.fillMaxWidth(), onClick) {
        Text("${formatBaseDateLabel(item.receiptDate)} · ${item.reportName}", fontWeight = FontWeight.Medium)
        Text("${submitterLabel(item.submitter, companyName)} · DART 원문 열기", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
