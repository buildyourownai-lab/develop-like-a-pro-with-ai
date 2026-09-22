<p align="left"><img src="assets/brand/book-symbol.png" alt="책 심벌" width="13%"><img src="assets/brand/brand-divider.svg" alt="" width="4.1%"><img src="assets/brand/book-title.svg" alt="프로처럼 AI로 코딩 없이 개발하기" width="49.6%"><img src="assets/brand/brand-divider.svg" alt="" width="4.1%"><img src="assets/brand/repository-title.svg" alt="국내주식 AI 브리핑" width="24.2%"></p>

![Claude Code](https://img.shields.io/badge/Claude%20Code-2.1.233-D1495B)
![TypeScript](https://img.shields.io/badge/Language-TypeScript-7357D8)
![Coverage](https://img.shields.io/badge/Coverage-93.6%25-3A86FF)
[![Production](https://img.shields.io/website?url=https%3A%2F%2Fai-stock-briefing.vercel.app%2F&up_message=Online&down_message=Offline&up_color=FFD166&down_color=lightgrey&label=Production)](https://ai-stock-briefing.vercel.app)
[![Unit Tests](https://img.shields.io/badge/Unit_Tests-35%2F35_PASS-2A9D8F)](tests/unit/)

`ai-stock-briefing`은 PART 3의 9–12장 웹서비스와 PART 4의 13–15장 모바일 앱을 함께 관리하는 공식 프로젝트 저장소입니다. 금융위원회 공식 시장 데이터와 OpenDART 공시를 모아 Gemini가 근거 범위 안에서 브리핑합니다.

## 서비스

### 웹

[ai-stock-briefing.vercel.app](https://ai-stock-briefing.vercel.app)

<a href="https://ai-stock-briefing.vercel.app"><img src="assets/screenshots/ai-stock-briefing.png" alt="국내주식 AI 브리핑 서비스 화면" width="100%"></a>

### 모바일 앱

<table>
  <tr>
    <th align="center">Android · 종목 상세</th>
    <th align="center">iPhone · AI 브리핑</th>
  </tr>
  <tr>
    <td width="50%"><a href="assets/screenshots/android-stock-detail.png"><img src="assets/screenshots/android-stock-detail.png" alt="Android 종목 상세 화면" width="100%"></a></td>
    <td width="50%"><a href="assets/screenshots/iphone-ai-briefing.png"><img src="assets/screenshots/iphone-ai-briefing.png" alt="iPhone AI 브리핑 화면" width="100%"></a></td>
  </tr>
</table>

## 장별 범위

- 9장: 시장 현황, 급등락, 종목 검색과 상세
- 10장: OpenDART 공시와 원문 연결
- 11장: 시장·공시 Evidence Packet을 사용한 Gemini 브리핑
- 12장: Supabase·Redis Cache로 속도·호출 제한·비용 개선
- 13장: 모바일 확장 판단과 API 계약
- 14장: `android/` Android 앱
- 15장: `ios/` iPhone 앱

이 서비스는 실시간 시세나 투자 추천 서비스가 아닙니다. 데이터 기준일을 화면에 표시하고 매수·매도 추천, 목표주가, 예측, 투자 점수를 만들지 않습니다.

## 환경변수

```text
DATA_GO_KR_SERVICE_KEY
OPEN_DART_API_KEY
GEMINI_API_KEY
GEMINI_MODEL
```

Secret은 `.env.local` 또는 배포 환경변수에만 두고 브라우저·앱·Git에 넣지 않습니다.

## 웹 실행

```bash
npm install
npm run dev
npm run build
npm start
```

## 테스트

```bash
npm test
npm run lint
npm run build
npm run test:web
npm run test:regression
npm run test:golden-path
npm run test:api
npm run test:chapter11:e2e
npm run test:chapter12:e2e
npm run test:chapter14:api
npm run test:part3
npm run scan:secrets
```

Playwright 테스트는 최신 Production Build를 사용하므로 먼저 `npm run build`를 실행합니다.

장별 실제 서비스 측정 근거는 [중앙 공개 검증 기록](https://github.com/buildyourownai-lab/develop-like-a-pro-with-ai/blob/main/verification/chapter-12/README.md)에서 확인할 수 있습니다.

## 주식 자료 대화(21–22장)

화면 오른쪽 아래 `AI에게 질문` 버튼으로 여는 대화 기능입니다. 기존 시장·검색·상세·차트·공시·AI 브리핑 화면은 그대로 두고 별도 레이어로만 동작합니다. 설계는 [`docs/ch21-chat-design.md`](docs/ch21-chat-design.md)에 있습니다.

### 22장 완성본은 바로 사용할 수 있습니다

기존 API 키를 설정하고 서버를 실행하면 대화 버튼이 나타납니다. `CHAT_ENABLED`를 따로 설정하지 않아도 켜집니다.

### 잠시 끄고 싶을 때

서버 환경에 아래 값을 넣고 서버를 다시 실행하거나 재배포합니다. 꺼진 동안에는 버튼이 사라지고 `/api/chat`은 404로 끝납니다.

```text
CHAT_ENABLED=false
```

다시 켜려면 위 설정을 지우거나 `true`로 바꿉니다. 새 Key나 대화 전용 저장소 없이 기존 `GEMINI_API_KEY`·`GEMINI_MODEL`을 재사용합니다. 설정 예시는 [`.env.example`](.env.example)에 있습니다.

### 한 질문에 걸어 둔 상한 (이 실습의 설정값이며 외부 서비스의 공식 한도가 아닙니다)

| 대상 | 값 |
|---|---|
| 질문 길이 | 1,000자 |
| 한 질문의 모델 호출 | 3회 |
| 한 질문의 자료 조회 | 4회 |
| 한 질문의 전체 시간 | 30초 |

상한에 닿으면 확보한 자료까지만 보여 주고 상한을 늘리지 않습니다. 자동 재시도는 하지 않습니다. 이 상한은 질문 하나 안에서만 세며, 하루·분 단위로 누적해 세는 장치는 없습니다.

### 물어볼 수 있는 것

- `변동성이 뭐야?` — 일반 설명만, 자료 조회 0회
- `삼성전자의 최근 공시 5건을 DART 원문과 함께 보여줘` — 확인된 공시 목록과 원문 링크
- `이 종목의 최근 확인 종가와 기준일 알려줘. 기준일이 왜 중요해?` — 종가·기준일(기간을 되묻지 않습니다)
- `최근 3개월 가격 흐름 알려줘` — 기간 요약. 기간을 말하지 않은 흐름 질문에는 달력 1개월·3개월·12개월 중에서 되묻습니다.

투자 추천·목표가·예측·미확인 기업 사실은 답하지 않습니다.

### 답변의 두 영역

- **확인된 자료**: 종목·종가·기준일·거래일 구간·공시·DART 원문 링크. 모든 수치·날짜·링크는 서버가 확인하고 만든 값이며 모델이 채우지 않습니다.
- **AI 일반 설명**: 개념·일반 원리. `최신 확인 자료가 아닙니다`를 항상 함께 표시합니다.

대화 내용은 현재 탭 메모리에만 남고 새로고침·페이지 이동으로 끝납니다. 서버는 대화를 저장하지 않습니다.

### 대화 기능 테스트

```bash
npm test                        # 대화 서버 로직 단위 테스트 포함
npm run test:chapter22:off      # 명시적으로 끈 상태: 버튼 없음, /api/chat 404
npm run test:chapter22:e2e      # 켠 상태(CHAT_ENABLED=true) 화면 확인
```

두 명령은 같은 시험 파일을 켜짐·꺼짐으로 나누어 실행합니다. runner가 설정을 직접 지정하므로 환경 파일에 남은 값과 섞이지 않습니다. 각 모드에 해당하지 않는 검사는 건너뜁니다. 이미 떠 있는 서버는 재사용하지 않습니다. macOS에서 확인했으며 Windows 실행은 미검증입니다.

runner는 `CHAT_E2E_MODE`라는 표시도 함께 넣습니다. `playwright.config.ts`는 **그 표시가 있을 때만** 22장 시험 서버의 `GEMINI_API_KEY`를 **비운 채로** 서버를 띄웁니다. 화면 시험은 `/api/chat` 응답을 브라우저에서 대신 만들어(mock) 확인하므로 실제 AI를 부를 필요가 없고, 열쇠가 없으면 실수로 부를 수도 없습니다. 여러분의 `.env`·`.env.local`은 읽거나 바꾸지 않습니다. 이 격리는 22장 대화 시험에만 적용되고 다른 시험 명령의 설정은 그대로입니다.

`test:chapter22:e2e`는 실제 AI API를 부르지 않습니다. 켠 상태 시험은 **모두** 브라우저에서 `/api/chat` 응답을 명시적으로 대신 만들어(mock) 화면 상태만 확인합니다. 모델 답변 품질의 증거가 아닙니다. 서버가 만드는 근거·문구는 `npm test`의 단위 테스트에서 확인합니다. 무엇을 확인했고 무엇이 남아 있는지는 [`docs/chat-verification.md`](docs/chat-verification.md)에 적었습니다.

## 모바일 빌드

```bash
cd android
./gradlew assembleDebug lintDebug

cd ../ios
swift test
```

Android Debug는 `http://10.0.2.2:3000`의 로컬 서버에 연결합니다. Release는 HTTPS 서버 주소를 설정하기 전에는 사용하지 않습니다.

## 최종 프로젝트

책에서 만드는 프로젝트의 최신 구현은 다음 개별 저장소에서 관리합니다.

<table width="100%">
  <thead>
    <tr>
      <th align="center" width="90">PART</th>
      <th align="center" width="90">장</th>
      <th align="center" width="223">저장소</th>
      <th align="center" width="326">내용</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center" width="90">1</td>
      <td align="center" width="90">1–5</td>
      <td align="left" width="223"><a href="https://github.com/buildyourownai-lab/movie-report"><code>movie-report</code></a></td>
      <td align="left" width="326">영화 흥행 보고서</td>
    </tr>
    <tr>
      <td align="center" width="90">2</td>
      <td align="center" width="90">6–8</td>
      <td align="left" width="223"><a href="https://github.com/buildyourownai-lab/apartment-explorer"><code>apartment-explorer</code></a></td>
      <td align="left" width="326">아파트 탐색 서비스</td>
    </tr>
    <tr>
      <td align="center" width="90">3</td>
      <td align="center" width="90">9–12</td>
      <td align="left" width="223"><a href="https://github.com/buildyourownai-lab/ai-stock-briefing"><code>ai-stock-briefing</code></a></td>
      <td align="left" width="326">국내주식 AI 브리핑 웹서비스</td>
    </tr>
    <tr>
      <td align="center" width="90">4</td>
      <td align="center" width="90">13–15</td>
      <td align="left" width="223"><a href="https://github.com/buildyourownai-lab/ai-stock-briefing"><code>ai-stock-briefing</code></a></td>
      <td align="left" width="326">Android·iPhone 앱</td>
    </tr>
    <tr>
      <td align="center" width="90">5</td>
      <td align="center" width="90">16–18</td>
      <td align="left" width="223"><a href="https://github.com/buildyourownai-lab/ai-shorts-maker"><code>ai-shorts-maker</code></a></td>
      <td align="left" width="326">AI 쇼츠 제작</td>
    </tr>
    <tr>
      <td align="center" width="90">6</td>
      <td align="center" width="90">19–20</td>
      <td align="left" width="223"><a href="https://github.com/buildyourownai-lab/ai-media-works"><code>ai-media-works</code></a></td>
      <td align="left" width="326">AI 미디어 운영</td>
    </tr>
    <tr>
      <td align="center" width="90">6</td>
      <td align="center" width="90">21–22</td>
      <td align="left" width="223"><a href="https://github.com/buildyourownai-lab/ai-stock-briefing"><code>ai-stock-briefing</code></a></td>
      <td align="left" width="326">주식 자료 대화 챗봇</td>
    </tr>
  </tbody>
</table>

## 문의 [![GitHub Issues](https://img.shields.io/badge/GitHub-Issues-0969DA?logo=github&logoColor=white)](https://github.com/buildyourownai-lab/ai-stock-briefing/issues)

자료 오류와 실습 문제는 [GitHub Issues](https://github.com/buildyourownai-lab/ai-stock-briefing/issues)에 남겨주세요.

Database와 Cache 연결값은 로컬과 Vercel에 같은 이름으로 등록합니다: SUPABASE_DATABASE_URL, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN. 연동 서비스가 다른 이름으로 등록한 값도 이 세 이름으로 맞추며, 실제 값은 대화나 Git에 남기지 않습니다.
