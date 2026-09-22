package com.aistockbriefing.android.network

import java.io.IOException

// 화면에는 예외의 원본 문구(서버 주소, 클래스 이름 등)를 그대로 보여주지
// 않는다. 사용자가 지금 다시 시도하면 되는지, 시간을 두고 다시 시도해야
// 하는지 구분할 수 있는 안내문으로 항상 바꿔서 보여준다.
//
// ApiException은 서버(Next.js API)가 이미 사람이 읽을 말로 만들어 보낸
// 메시지이므로 그대로 보여준다(예: "종목을 찾지 못했습니다."). 그 밖의
// 예외는 이 앱이 서버에 연결조차 하지 못했거나(IOException) 예상치 못한
// 문제이므로, 원인을 밝히지 않는 안내문으로 대신한다.
fun Throwable.toUserMessage(): String = when {
    this is ApiException -> message ?: "요청이 실패했습니다. 잠시 후 다시 시도해 보세요."
    this is IOException -> "인터넷 연결을 확인해 주세요. 연결이 되면 다시 시도해 보세요."
    else -> "일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 보세요."
}
