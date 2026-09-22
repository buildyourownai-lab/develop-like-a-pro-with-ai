package com.aistockbriefing.android.ui

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.aistockbriefing.android.model.IndexSummary
import com.aistockbriefing.android.model.MarketOverview
import com.aistockbriefing.android.model.RankedStock
import com.aistockbriefing.android.network.StockRepository
import com.aistockbriefing.android.network.toUserMessage
import com.aistockbriefing.android.ui.theme.NoticeColor
import com.aistockbriefing.android.ui.theme.directionColor

@Composable
fun MarketScreen(navController: NavHostController) {
    val state by produceState<UiState<MarketOverview>>(
        initialValue = UiState.Loading
    ) {
        value = try {
            UiState.Success(StockRepository.getMarket())
        } catch (e: Exception) {
            UiState.Error(e.toUserMessage())
        }
    }

    var query by remember { mutableStateOf("") }
    val keyboardController = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current

    // 검색을 마치면 다른 화면으로 넘어가기 전에 키보드를 먼저 닫는다 — 화면
    // 이동만으로는 소프트 키보드가 자동으로 닫히지 않아, 닫지 않으면 다음
    // 화면(검색 결과·종목 상세)의 위쪽이 키보드에 가려진다.
    fun submitSearch() {
        if (query.isNotBlank()) {
            keyboardController?.hide()
            focusManager.clearFocus()
            navController.navigate("search/${Uri.encode(query.trim())}")
        }
    }

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant).padding(16.dp)) {
        AppHeaderWithSearch(
            query = query,
            onQueryChange = { query = it },
            onSearch = { submitSearch() },
            statusMessage = when (state) {
                is UiState.Loading -> "데이터를 불러오는 중입니다."
                is UiState.Success -> null
                is UiState.Error -> null
            },
        )

        when (val s = state) {
            is UiState.Loading -> LoadingIndicator()
            is UiState.Error -> Text(s.message)
            is UiState.Success -> MarketContent(s.data, navController)
        }
    }
}

@Composable
private fun MarketContent(
    overview: MarketOverview,
    navController: NavHostController,
) {
    // 같은 기준일은 한 번만 보여주고, 지수와 종목 날짜가 다를 때만 차이를 알린다.
    val indexBaseDate = overview.indices.firstOrNull()?.baseDate

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (indexBaseDate != null && indexBaseDate != overview.stockBaseDate) {
            item {
                Text(
                    "지수 기준일(${formatBaseDateLabel(indexBaseDate)})과 종목 시세 기준일(" +
                        "${formatBaseDateLabel(overview.stockBaseDate)})이 다릅니다.",
                    color = NoticeColor,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        item {
            Text(
                "주식시세 기준일 ${formatBaseDateLabel(overview.stockBaseDate)}",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(bottom = 6.dp),
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                overview.indices.forEach { index ->
                    IndexCard(index, Modifier.weight(1f))
                }
            }
        }

        item {
            Row(modifier = Modifier.padding(top = 16.dp, bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Text("▲", color = directionColor(1.0), modifier = Modifier.background(directionColor(1.0).copy(alpha = 0.10f), CircleShape).padding(10.dp))
            Text(
                "상승률 상위",
                    style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            }
        }
        items(overview.topGainers) { stock -> RankedStockCard(stock, navController) }

        item {
            Row(modifier = Modifier.padding(top = 16.dp, bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Text("▼", color = directionColor(-1.0), modifier = Modifier.background(directionColor(-1.0).copy(alpha = 0.10f), CircleShape).padding(10.dp))
                Text("하락률 상위", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
        }
        items(overview.topLosers) { stock -> RankedStockCard(stock, navController) }

        item {
            Column(modifier = Modifier.padding(top = 20.dp)) {
                Text(
                    "금융위원회 공식 주식 데이터 · 종목을 누르면 상세 화면으로 이동합니다.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
private fun IndexCard(index: IndexSummary, modifier: Modifier = Modifier) {
    ListCard(modifier = modifier) {
        Column {
            Text(index.name, fontWeight = FontWeight.Bold)
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(formatIndexValue(index.value), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Column(horizontalAlignment = androidx.compose.ui.Alignment.End) {
                    Text(formatChange(index.change), color = directionColor(index.changeRate), fontWeight = FontWeight.Bold)
                    Text("(${formatChangeRate(index.changeRate)})", color = directionColor(index.changeRate), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
                }
            }
            Text(
                "거래대금 ${formatTradingValue(index.tradingValue)}",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun RankedStockCard(stock: RankedStock, navController: NavHostController) {
    ListCard(
        modifier = Modifier.fillMaxWidth(),
        onClick = { navController.navigate("stock/${stock.code}") },
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text("${stock.name} · ${stock.code}", fontWeight = FontWeight.Bold)
            Row {
                Text(
                    "${formatPrice(stock.price)} · ${formatChangeRate(stock.changeRate)}",
                    color = directionColor(stock.changeRate),
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}
