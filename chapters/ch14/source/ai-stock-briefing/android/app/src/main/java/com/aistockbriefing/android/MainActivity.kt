package com.aistockbriefing.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.aistockbriefing.android.ui.MarketScreen
import com.aistockbriefing.android.ui.SearchScreen
import com.aistockbriefing.android.ui.StockDetailScreen
import com.aistockbriefing.android.ui.DisclosuresScreen
import com.aistockbriefing.android.ui.theme.AiStockBriefingTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AiStockBriefingTheme {
                Surface(
                    modifier = Modifier
                        .fillMaxSize()
                        .windowInsetsPadding(WindowInsets.safeDrawing)
                ) {
                    val navController = rememberNavController()
                    NavHost(navController = navController, startDestination = "market") {
                        composable("market") {
                            MarketScreen(navController)
                        }
                        composable("search/{query}") { backStackEntry ->
                            val query = backStackEntry.arguments?.getString("query").orEmpty()
                            SearchScreen(navController, query)
                        }
                        composable("stock/{code}") { backStackEntry ->
                            val code = backStackEntry.arguments?.getString("code").orEmpty()
                            StockDetailScreen(navController, code)
                        }
                        composable("stock/{code}/disclosures/{name}") { backStackEntry ->
                            val code = backStackEntry.arguments?.getString("code").orEmpty()
                            val name = backStackEntry.arguments?.getString("name").orEmpty()
                            DisclosuresScreen(code, name)
                        }
                    }
                }
            }
        }
    }
}
