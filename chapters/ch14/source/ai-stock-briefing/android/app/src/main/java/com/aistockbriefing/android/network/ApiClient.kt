package com.aistockbriefing.android.network

import com.aistockbriefing.android.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

// 서버가 만든 결과만 받는다 — 외부 서비스 인증키(공공데이터포털·OpenDART·
// Gemini)는 이 앱 어디에도 넣지 않는다. 서버 주소만 빌드 타입별로 다르다
// (BuildConfig.API_BASE_URL, app/build.gradle.kts에서 debug/release로 분리).
object ApiClient {
    @PublishedApi
    internal val json = Json { ignoreUnknownKeys = true }

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private val baseUrl get() = BuildConfig.API_BASE_URL.toHttpUrl()

    fun urlBuilder(vararg pathSegments: String) =
        baseUrl.newBuilder().apply { pathSegments.forEach { addPathSegment(it) } }

    suspend fun get(url: okhttp3.HttpUrl): String = withContext(Dispatchers.IO) {
        execute(Request.Builder().url(url).get().build())
    }

    suspend fun post(url: okhttp3.HttpUrl): String = withContext(Dispatchers.IO) {
        val body = "".toRequestBody("application/json".toMediaType())
        execute(Request.Builder().url(url).post(body).build())
    }

    private fun execute(request: Request): String {
        client.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (body.isEmpty()) {
                throw ApiException("서버 응답이 비어 있습니다 (HTTP ${response.code}).")
            }
            if (!response.isSuccessful) {
                val error = runCatching {
                    val value = json.parseToJsonElement(body).jsonObject["error"]
                    (value as? JsonPrimitive)?.content
                }.getOrNull()
                throw ApiException(error ?: "서버 요청이 실패했습니다 (HTTP ${response.code}).")
            }
            return body
        }
    }

    // 이 프로젝트의 API는 전체 실패일 때만 {error: "..."} 하나만 돌려주고
    // (예: 종목을 찾지 못한 404), 정상 응답에는 최상위 error가 없다. 먼저
    // 그 실패 형태인지 확인해, 맞으면 그 메시지로 예외를 던진다 — 없으면
    // 다른 필드가 없어 T로 바로 디코딩하면 실패하기 때문이다.
    inline fun <reified T> decodeOrThrow(rawJson: String): T {
        val element = json.parseToJsonElement(rawJson).jsonObject
        val error = (element["error"] as? JsonPrimitive)?.content
        if (error != null) {
            throw ApiException(error)
        }
        return json.decodeFromString(rawJson)
    }
}

class ApiException(message: String) : Exception(message)
