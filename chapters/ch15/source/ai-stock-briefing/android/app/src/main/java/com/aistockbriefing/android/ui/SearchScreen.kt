package com.aistockbriefing.android.ui

import android.net.Uri
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.aistockbriefing.android.model.SearchResponse
import com.aistockbriefing.android.model.StockSearchResult
import com.aistockbriefing.android.network.StockRepository
import com.aistockbriefing.android.network.toUserMessage

@Composable
fun SearchScreen(navController: NavHostController, query: String) {
    val state by produceState<UiState<SearchResponse>>(initialValue = UiState.Loading, query) {
        value = try {
            UiState.Success(StockRepository.search(query))
        } catch (e: Exception) {
            UiState.Error(e.toUserMessage())
        }
    }

    var searchQuery by remember(query) { mutableStateOf(query) }
    val keyboardController = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    fun submitSearch() {
        if (searchQuery.isNotBlank()) {
            keyboardController?.hide()
            focusManager.clearFocus()
            navController.navigate("search/${Uri.encode(searchQuery.trim())}")
        }
    }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        AppHeaderWithSearch(
            query = searchQuery,
            onQueryChange = { searchQuery = it },
            onSearch = { submitSearch() },
            statusMessage = when (state) {
                is UiState.Loading -> "데이터를 불러오는 중입니다."
                is UiState.Success -> null
                is UiState.Error -> null
            },
        )
        Text("\"$query\" 검색 결과", style = MaterialTheme.typography.headlineSmall)

        when (val s = state) {
            is UiState.Loading -> LoadingIndicator()
            is UiState.Error -> Text(s.message)
            is UiState.Success -> SearchResultContent(navController, s.data.results)
        }
    }
}

@Composable
private fun SearchResultContent(
    navController: NavHostController,
    results: List<StockSearchResult>,
) {
    // 결과가 정확히 하나면 웹(검색 결과 화면)과 같이 곧바로 상세 화면으로
    // 이동한다. 검색 화면은 뒤로 가기에 남지 않게 스택에서 제거한다.
    if (results.size == 1) {
        LaunchedEffect(results) {
            navController.navigate("stock/${results[0].code}") {
                popUpTo("market")
            }
        }
        return
    }

    if (results.isEmpty()) {
        Text("일치하는 종목이 없습니다. 종목명 전체나 여섯 자리 종목코드로 다시 검색해 보세요.")
        return
    }

    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(results) { result ->
            ListCard(
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    navController.navigate("stock/${result.code}") {
                        popUpTo("market")
                    }
                },
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column {
                        Text(result.name, fontWeight = FontWeight.Bold)
                        Text(
                            "${result.code} · ${result.market}",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    NavigationChevron()
                }
            }
        }
    }
}
