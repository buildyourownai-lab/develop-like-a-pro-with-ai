# 14장을 끝낸 상태의 ai-stock-briefing

## 이 Source는 언제 사용하나요?

13장에서 정한 계획대로 기존 주식 웹서비스를 Android 앱으로 확장한 상태입니다. 앱이
직접 읽는 서버 기능과 Android 앱 프로젝트가 함께 들어 있습니다. 정답지가 아닙니다.

책을 따라가다 막혔을 때 순서는 이렇습니다.

```text
디버깅 → 내 정상 기록으로 복구 → 장별 Source로 재시작
```

이 Source는 마지막 단계입니다. 앞의 두 방법으로도 이어갈 수 없을 때, 15장부터 계속
진행하기 위해 사용합니다.

9장부터 14장까지 만든 파일이 모두 들어 있습니다. 6~8장의 아파트 프로젝트는
chapters/ch08/source/apartment-explorer에 따로 있습니다.

## 14장에서 새로 생긴 것

| 무엇 | 어디 |
|---|---|
| 시장·검색·차트·공시·AI 브리핑을 보여주는 Android 앱 화면 | android/app/src/main/java/com/aistockbriefing/android/ui/ |
| 앱이 서버 자료를 받아 화면에 넘기는 기능 | android/app/src/main/java/com/aistockbriefing/android/network/ |
| 서버가 보내온 자료를 앱에서 다루는 형태 | android/app/src/main/java/com/aistockbriefing/android/model/ |
| 공시 제출인을 웹 화면과 같은 형식으로 표시하는 기능 | android/app/src/main/java/com/aistockbriefing/android/ui/DisclosureUi.kt |
| 검색 결과가 없을 때와 서버에 연결되지 않을 때 사람이 읽는 말로 알려주는 기능 | android/app/src/main/java/com/aistockbriefing/android/network/ErrorMessages.kt |
| 연습용 연결과 실제 배포 앱의 연결을 나눈 Build 설정 | android/app/build.gradle.kts, android/app/src/debug/res/xml/network_security_config.xml |
| 앱이 인터넷 권한만 사용한다는 것을 적은 설정 | android/app/src/main/AndroidManifest.xml |
| 숫자 표시와 공시 표시, 실패 안내를 확인하는 Android Test | android/app/src/test/java/com/aistockbriefing/android/ |
| 앱이 시장 자료를 받아가는 자리 | src/app/api/mobile/market/route.ts |
| 앱이 종목을 검색하는 자리 | src/app/api/mobile/stocks/search/route.ts |
| 앱이 종목 가격과 1년 시세를 받아가는 자리 | src/app/api/mobile/stocks/[code]/route.ts |
| 앱이 그 종목의 공시를 받아가는 자리 | src/app/api/mobile/stocks/[code]/filings/route.ts |
| 앱이 AI 브리핑을 요청하는 자리 | src/app/api/stocks/[code]/briefing/route.ts |
| 모바일 경로와 응답 경계를 확인하는 Test | tests/mobile-api-routes.test.ts, android/app/src/test/java/com/aistockbriefing/android/MobileContractTest.kt |

Android 앱의 내부 구조와 파일 이름은 사람마다 달라집니다. 14장이 확인하는 것은 파일
이름이 아니라 실제 Emulator에서 시장·검색·차트·공시 원문·AI 브리핑을 사용할 수 있는지
입니다.

브리핑을 만드는 방식은 11장과 같습니다. 앱은 Gemini를 직접 부르지 않고 기존 서버에
요청하며, 서버가 공식 자료를 모아 검증한 브리핑을 돌려줍니다.

## 13장까지 만든 웹서비스

| 무엇 | 어디 |
|---|---|
| 기준일과 코스피·코스닥, 상승률 상위·하락률 상위, 검색창이 있는 시장 화면 | src/app/page.tsx |
| 종목명이나 종목코드로 찾은 결과를 보여주는 화면 | src/app/search/page.tsx |
| 현재가와 기준가 대비 등락, 시가·고가·저가, 최근 공시, AI 브리핑을 보여주는 종목 화면 | src/app/stocks/[code]/page.tsx |
| 최근 1년의 일봉과 거래량을 그리고 공시 시점을 표시하는 차트 | src/app/stocks/[code]/StockChart.tsx |
| 그 기간의 공시를 100건씩 나눠 보고 공식 유형으로 좁히는 화면 | src/app/stocks/[code]/disclosures/page.tsx |
| 버튼을 눌렀을 때만 브리핑을 만들고 결과를 나눠 보여주는 영역 | src/app/stocks/[code]/AiBriefingSection.tsx |
| 브라우저 요청을 받아 자료를 준비하고 Gemini를 부르는 자리 | src/app/stocks/[code]/briefing-actions.ts |
| 브리핑에 쓸 사실을 고르고 숫자를 직접 계산하는 기능 | src/lib/briefing-facts.ts |
| Gemini가 돌려준 결과를 화면에 내보내기 전에 확인하는 기능 | src/lib/briefing-verify.ts |
| Gemini를 부르고 실패와 시간 초과를 다루는 기능 | src/lib/gemini-briefing-api.ts |
| 주식시세정보·지수시세정보·KRX상장종목정보를 읽는 기능 | src/lib/stock-price-api.ts, src/lib/market-index-api.ts, src/lib/krx-listed-info-api.ts |
| 가장 최근에 제공된 거래일을 찾는 기능 | src/lib/trading-date.ts |
| 종목코드를 OpenDART 회사 고유번호로 연결하는 기능 | src/lib/dart-corp-code.ts |
| 공시 목록과 공식 유형, DART 원문 주소를 읽는 기능 | src/lib/dart-disclosure-api.ts |
| 가져온 외부 자료를 Database에 저장하고 유효시간이 지난 것만 다시 확인하는 기능 | src/lib/api-cache.ts, src/lib/db.ts |
| 같은 근거와 같은 모델이면 브리핑을 다시 만들지 않게 하는 기능 | src/lib/briefing-cache.ts, src/lib/redis.ts |
| 사용량 한도에 도달한 동안 Gemini 호출을 멈추는 기능 | src/lib/gemini-rate-limit.ts |
| 인증키와 연결 정보를 브라우저에서 직접 입력하는 내 컴퓨터 전용 화면 | src/app/setup/ |
| 인증키를 서버에서만 읽고 오류 메시지에서 가리는 기능 | src/lib/server-env.ts, src/lib/redact.ts |
| 앱을 만들기 전에 사람이 결정한 내용을 정리한 계획 | docs/mobile-app-plan.md |
| 기준일과 순위 조건, 공시 조회, 브리핑 근거와 결과 확인, 저장한 값의 재사용, 인증키 노출을 확인하는 Test | tests/ |
| 브라우저에서 실제 흐름을 눌러보는 Test | tests/e2e/ |

인증키는 들어 있지 않습니다. .env.local.example을 보고 자기 인증키를 넣으면 됩니다.
주식시세정보와 지수시세정보, KRX상장종목정보 세 API가 공공데이터포털 인증키 하나를 함께
사용하고, 공시는 OpenDART 인증키, 브리핑은 Google AI Studio의 Gemini API Key를 따로
사용합니다. Database와 Cache는 Supabase 연결 문자열과 Upstash Redis의 주소·Token을
사용합니다.

Android 앱에는 외부 서비스 Secret이 들어 있지 않습니다. 앱은 서버 주소만 알고 있고,
외부 서비스 인증은 서버가 맡습니다.

이 프로젝트의 Test는 실제 금융위원회와 OpenDART 응답, 실제 Gemini 호출까지 확인하므로,
Test를 실행하려면 자기 인증키가 필요합니다.

## Claude Code에서 이어서 사용하기

이 폴더를 Claude Code에서 열고 그대로 입력하면 됩니다.

```text
이 폴더는 책 14장을 끝낸 상태의 프로젝트야.
실행에 필요한 환경이 준비되어 있는지 확인하고, 없으면 준비해줘.
내 인증키와 Database, Cache 접속 정보를 넣을 자리를 알려주고
웹서비스 Test를 실행해서 결과를 보여줘.
그다음 android 폴더의 Android 앱을 공식 Emulator에 설치해
시장 화면과 종목 검색이 실제로 동작하는지 확인해줘.
```

Android 앱을 실행하려면 Android SDK와 Emulator가 필요합니다. 설치가 필요하면 공식
출처와 다운로드 용량, 약관을 먼저 확인하고 승인합니다.

## 내 결과와 달라도 괜찮습니다

같은 요청문을 입력해도 앱의 화면 배치와 파일 이름, 내부 구조는 달라집니다. 기준은
코드가 같은지가 아니라 14장의 완료 조건을 만족하는지입니다.

- 공식 Emulator에 앱이 설치되고 첫 화면이 실제 서버 자료로 채워집니다.
- 시장 기준일과 코스피·코스닥, 상승률 상위·하락률 상위 종목이 보입니다.
- 종목명이나 종목코드로 검색해 상세 화면으로 들어갑니다.
- 1개월·3개월·1년 차트와 거래량을 봅니다.
- 최근 공시에서 DART 공식 원문으로 이동합니다.
- 검색 결과가 없을 때와 서버에 연결되지 않을 때를 사람이 읽는 말로 구분해 알려줍니다.
- AI 브리핑에서 근거와 출처, 알 수 없는 것을 확인합니다.
- 앱에 외부 서비스 Secret이 없고, 인터넷 외의 권한을 요청하지 않습니다.

## 검증 결과

빈 폴더에 이 Source만 놓고 준비와 Test 실행까지 확인했습니다. 근거는
[verification/chapter-14/](../../../../verification/chapter-14/)에 있습니다.

Database와 Cache 연결값은 로컬과 Vercel에 같은 이름으로 등록합니다: SUPABASE_DATABASE_URL, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN. 연동 서비스가 다른 이름으로 등록한 값도 이 세 이름으로 맞추며, 실제 값은 대화나 Git에 남기지 않습니다.
