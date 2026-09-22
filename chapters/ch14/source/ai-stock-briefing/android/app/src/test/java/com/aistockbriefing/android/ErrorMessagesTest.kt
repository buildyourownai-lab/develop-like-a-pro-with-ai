package com.aistockbriefing.android

import com.aistockbriefing.android.network.ApiException
import com.aistockbriefing.android.network.toUserMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.IOException
import java.net.ConnectException
import java.net.UnknownHostException

// 화면에 예외의 원본 문구(서버 주소, 클래스 이름 등)가 그대로 나가지
// 않는지, 서버가 이미 사람이 읽을 말로 보낸 메시지는 그대로 전달되는지
// 확인한다.
class ErrorMessagesTest {

    @Test
    fun `서버가 사람이 읽을 말로 만든 예외는 그대로 보여준다`() {
        assertEquals(
            "종목을 찾지 못했습니다.",
            ApiException("종목을 찾지 못했습니다.").toUserMessage(),
        )
    }

    @Test
    fun `연결 실패는 서버 주소를 감추고 인터넷 연결 안내로 바꾼다`() {
        val e = ConnectException("Failed to connect to /10.0.2.2:3000")
        val message = e.toUserMessage()
        assertFalse(message.contains("10.0.2.2"))
        assertEquals("인터넷 연결을 확인해 주세요. 연결이 되면 다시 시도해 보세요.", message)
    }

    @Test
    fun `호스트를 찾을 수 없을 때도 인터넷 연결 안내로 바꾼다`() {
        val message: String = UnknownHostException("api.example.com").toUserMessage()
        assertEquals("인터넷 연결을 확인해 주세요. 연결이 되면 다시 시도해 보세요.", message)
    }

    @Test
    fun `그 밖의 예외는 원인을 밝히지 않고 잠시 후 다시 시도하라고 안내한다`() {
        val message = IllegalStateException("NullPointerException at Foo.kt:42").toUserMessage()
        assertFalse(message.contains("Foo.kt"))
        assertEquals("일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 보세요.", message)
    }

    @Test
    fun `IOException 계열은 모두 네트워크 안내로 취급한다`() {
        val message = IOException("stream closed").toUserMessage()
        assertEquals("인터넷 연결을 확인해 주세요. 연결이 되면 다시 시도해 보세요.", message)
    }
}
