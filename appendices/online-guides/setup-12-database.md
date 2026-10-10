# 12장 · Supabase 프로젝트와 연결값 준비

## 먼저 준비할 것

11장까지 만든 `ai-stock-briefing` 프로젝트를 엽니다. 먼저 [12장의 Secret 입력창 요청](https://www.studyailab.com/develop/chapters/12#P12-02)을 실행하고, Claude가 알려준 `localhost` 또는 `127.0.0.1` 주소를 브라우저에서 엽니다. 입력창을 이미 만들었다면 다시 만들지 않고 같은 창을 사용합니다. 실제 값은 대화에 붙여 넣지 않습니다.

8장에서 사용한 Vercel Dashboard로 이동합니다.

**Vercel Dashboard**  
https://vercel.com/dashboard

1. Vercel에 로그인합니다.
2. 국내 주식 서비스를 배포한 프로젝트를 선택합니다.
3. 프로젝트의 **Storage** 메뉴로 들어갑니다.
4. **Create Database** 또는 새 저장소를 연결하는 버튼을 누릅니다.
5. 목록에서 **Supabase**를 선택합니다.

Supabase가 목록에 없으면 Vercel **Marketplace**에서 검색합니다. 연결 화면을 사용할 수 없다면 Supabase 공식 Dashboard에서 직접 프로젝트를 만듭니다.

직접 만든 경우에는 뒤의 Vercel 연결 화면 대신 **Project Settings → Database → Connection string → Transaction pooler**에서 연결 문자열을 확인합니다.

**Supabase Dashboard**  
https://supabase.com/dashboard

Supabase 사용 약관과 연결할 Vercel 계정을 확인한 뒤 **Configuration and
Plan** 단계로 이동합니다.


### 서버와 Database는 가까운 지역을 선택합니다

8장에서 Vercel의 실행 Region을 **Seoul, South Korea (`icn1`)**로 고르는 방법을 배웠습니다. 이번 주식 서비스에서도 현재 배포의 Region을 확인합니다.

이번에는 그 서버가 자주 사용할 Database를 만듭니다. 서버와 Database가 멀리
떨어져 있으면 데이터를 주고받는 데 불필요한 시간이 생길 수 있으므로
Supabase도 **Seoul, South Korea**를 선택합니다.

> **서버와 자주 통신하는 Database는 특별한 이유가 없다면 가까운 Region을
> 선택합니다.**

서버는 시세·차트·지수·종목 정보를 읽으며 Database와 여러 번 통신합니다. 거리가 멀어 통신이 늦어지면 그 지연도 반복해서 쌓일 수 있습니다.

이 차이는 서비스 전체 응답시간이 아니라 서버 내부에서 데이터를 주고받는
시간에 나타나고, 환경에 따라 정도도 달라집니다.

프로젝트 이름은 `ai-stock-briefing-db`로 입력하고 지역은 **Seoul, South
Korea**를 고릅니다.

2026년 9월 이 계정에는 활성 Free 프로젝트 2개 한도가 표시됐습니다. **Free Plan을 선택할 수 있을 때만** 진행합니다. 한도 안내가 나오면 유료 플랜을 대신 고르지 말고, 기존 프로젝트를 정리할지 요금제를 바꿀지 먼저 판단합니다. 무료 제공량과 버튼 위치는 실습 시점의 화면에서 다시 확인합니다.

Free Plan을 선택할 수 있고 비용 조건을 확인했다면 **Install** 또는 프로젝트
생성 버튼을 누릅니다. 생성에는 잠시 시간이 걸릴 수 있습니다. 완료 화면에서
`ai-stock-briefing-db`의 상태가 **Available**인지 확인합니다. 아래 완료 화면은
한도에 도달하기 전에 만들어 둔 기존 Free Plan Database입니다.

![Supabase의 지역·플랜 선택과 기존 Database 상태](https://www.studyailab.com/develop/guides/chapter-12/screen-12-01-02-supabase-region-plan-and-available.png)

\[화면 12-1 \| Seoul 리전과 현재 선택 가능한 플랜을 확인하고, 기존 Supabase Database가 Available·Supabase Free 상태인지 확인하는 화면 --- 연결 환경변수 값은 가렸다\]

서비스와 Database를 연결합니다.

1. `ai-stock-briefing-db` 완료 화면에서 **Connect to Project**를 누릅니다.
2. 프로젝트를 고르는 화면이 나타나면 현재 국내 주식 서비스 프로젝트를
   선택합니다.
3. 연결 정보 화면에서 **.env.local** 탭을 엽니다.
4. `POSTGRES_URL` 또는 **Transaction pooler** 연결 문자열을 찾습니다.
5. 값을 복사해 앞에서 열어 둔 로컬 입력창의 **Supabase Database URL**에
   직접 붙여 넣습니다.
6. 입력창의 저장 버튼을 누릅니다. Upstash 두 칸은 아직 비어 있어도
   됩니다.

여기서 저장해야 다음 요청이 연결값을 읽을 수 있습니다. Upstash 값도 같은 창에 넣을 것이므로 입력창은 계속 열어둡니다.

이번 구현에 필요한 Supabase 값은 이 연결 문자열 하나입니다. 프로젝트
화면에 여러 Key가 보여도 모두 복사하지 않습니다.

연결 문자열과 비밀번호는 Secret입니다. Claude 대화창, 공유 문서와 화면,
코드, Git에 붙여 넣지 않습니다. 로컬 입력창은 값을 서버 전용 환경변수
`SUPABASE_DATABASE_URL`로 저장합니다.

~~~prompt
국내 주식 한눈에 서비스에 Supabase Database를 연결해줘.

실제 연결 정보는 내가 안전한 입력 위치에 직접 넣을게. 대화창에 값을
붙여 넣으라고 하지 말고 `SUPABASE_DATABASE_URL` 환경변수로만 읽어줘.

Secret이 코드, Git, 브라우저, 로그와 오류 메시지에 노출되지 않는지도
검사해줘.
~~~

------------------------------------------------------------------------

## 준비 후 다음 단계

연결값을 로컬 입력창에 저장한 뒤 [12장 실습](https://www.studyailab.com/develop/chapters/12)으로 돌아가 해당 연결 요청과 검사를 순서대로 진행합니다. 값 저장은 실제 연결·Cache 동작 확인을 대신하지 않습니다.
