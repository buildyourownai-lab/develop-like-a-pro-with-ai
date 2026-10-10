# 12장 · Upstash Redis와 연결값 준비

책의 상세 지원 자료입니다. 책에 없는 추가 안내는 필요할 때만 사용합니다. 화면과 정책의 과거 확인 기록은 현재 지원·요금·실행 성공을 보증하지 않습니다. 현재 계정의 공식 안내를 함께 확인하세요.

## Redis Cache를 준비합니다

다시 Vercel Dashboard에서 현재 국내 주식 서비스 프로젝트의 **Storage**로
이동합니다.

1. **Create Database** 또는 새 저장소 연결 버튼을 누릅니다.
2. 목록에서 **Upstash for Redis**를 선택합니다.
3. Upstash 사용 약관과 연결할 프로젝트를 확인합니다.
4. **Configuration and Plan** 단계로 이동합니다.

목록에서 찾을 수 없다면 Vercel **Marketplace**에서 Upstash를 검색합니다.
직접 만드는 경로가 필요하면 Upstash 공식 Console을 사용합니다.

**Upstash Console**  
https://console.upstash.com/

Cache 이름은 `ai-stock-briefing-cache`로 입력합니다.

지역은 앞의 Database와 같은 기준으로 한국에서 가까운 곳을 고릅니다. 검증
과정에서는 **Tokyo, Japan (Northeast)**을 선택했습니다. 선택할 수 있는 지역
목록은 서비스마다 다르므로, 목록에 한국에 더 가까운 곳이 있다면 그곳을
선택합니다.

2026년 9월 Vercel의 새 Upstash 설치 화면에는 **Free** 대신 **Pay As You Go --- 10만 명령당 0.2달러**가 표시됐습니다. 현재 가격과 사용량에 따른 비용을 확인하고 동의할 때만 진행합니다.

유료 **Prod Pack**과 **Auto Upgrade**는 끕니다. **Eviction**은 용량 한도에서 항목을 지울지 정하는 옵션이므로 의미를 확인한 뒤 선택합니다. 촬영 당시에는 세 옵션을 모두 껐습니다. 무료 플랜이나 가격이 달라졌다면 실습 시점의 조건으로 판단합니다.

가격과 설정을 확인했다면 **Install** 또는 생성 버튼을 누릅니다. 완료 화면에서 `ai-stock-briefing-cache`가 **Available**인지 봅니다.

아래 화면의 **Free**는 이전 정책으로 만든 Cache의 플랜입니다. 지금 새로 만들 때도 Free를 선택할 수 있다는 뜻은 아닙니다.

![Upstash Redis의 지역·플랜 선택과 기존 Cache 상태](https://www.studyailab.com/develop/guides/chapter-12/screen-12-03-04-upstash-region-plan-and-available.png)

\[화면 12-3 \| Tokyo 리전과 현재 Pay As You Go 조건을 확인하고, 기존 Upstash Cache가 Available·Free 상태인지 구분하는 화면 --- 연결 환경변수 값은 가렸다\]


Cache 연결값을 로컬 입력창에 넣습니다.

1. `ai-stock-briefing-cache` 완료 화면에서 **Connect to Project**를 누릅니다.
2. **.env.local** 탭을 엽니다.
3. `KV_REST_API_URL` 값을 복사해 **Upstash Redis REST URL**에 붙여 넣습니다.
4. `KV_REST_API_TOKEN` 값을 복사해 **Upstash Redis REST Token**에 붙여
   넣습니다.
5. 입력창의 저장 버튼을 누릅니다.

Upstash Console에서 직접 만들었다면 이름이 `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`으로 보일 수 있습니다. 필요한 값은 **REST URL**과 쓰기 가능한 **REST Token**입니다. URL은 Cache의 주소이고, Token은 값을 읽고 저장할 권한을 증명합니다.

접속 URL과 Token은 모두 Secret입니다. 실제 값이 보이는 상태로 화면을
촬영하지 않고 서버 환경변수로만 사용합니다.

~~~prompt
같은 근거로 만든 Gemini 브리핑을 Upstash Redis에 Cache해줘.

접속 정보는 내가 안전한 입력 위치에 직접 넣을게. 실제 값은 대화창이나
코드에 붙여 넣지 말고 `UPSTASH_REDIS_REST_URL`과
`UPSTASH_REDIS_REST_TOKEN` 환경변수로만 읽어줘.

URL과 Token이 Git, 브라우저, 로그, 오류 메시지와 검증 결과에 노출되지
않는지도 검사해줘.
~~~

------------------------------------------------------------------------
