# 12장을 끝낸 상태의 ai-stock-briefing

## 이 Source는 언제 사용하나요?

금융위원회 공식 주식 데이터로 시장 화면과 종목 화면, 최근 1년 차트를 만들고, 금융감독원
OpenDART의 공시를 붙인 뒤, 그 자료만 근거로 Gemini가 한국어 브리핑을 만드는 상태입니다.
여기에 가져온 주식 데이터는 Supabase Database에 저장해 다시 사용하고, 만들어진 브리핑은
Upstash Redis에 잠시 저장해 같은 조건이면 Gemini를 다시 부르지 않습니다.
정답지가 아닙니다.

책을 따라가다 막혔을 때 순서는 이렇습니다.

```text
디버깅 → 내 정상 기록으로 복구 → 장별 Source로 재시작
```

이 Source는 마지막 단계입니다. 앞의 두 방법으로도 이어갈 수 없을 때, 13장부터 계속
진행하기 위해 사용합니다. 이 Source로 시작하면 12장의 남은 실습은 건너뛰게 됩니다.

9장부터 12장까지 만든 파일이 모두 들어 있습니다. 6~8장의 아파트 프로젝트는
chapters/ch08/source/apartment-explorer에 따로 있습니다.

## 무엇이 들어 있나요?

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
| 사용하는 Gemini 모델 ID를 한곳에서 관리하는 자리 | src/lib/gemini-config.ts |
| 상승·하락을 색 없이도 읽게 하는 표시 | src/components/ChangeIndicator.tsx |
| 등락률 순위의 집계 대상을 정하는 기준 | src/lib/market.ts |
| 주식시세정보를 읽는 기능 | src/lib/stock-price-api.ts |
| 지수시세정보를 읽는 기능 | src/lib/market-index-api.ts |
| KRX상장종목정보로 종목을 찾는 기능 | src/lib/krx-listed-info-api.ts |
| 가장 최근에 제공된 거래일을 찾는 기능 | src/lib/trading-date.ts |
| 종목코드를 OpenDART 회사 고유번호로 연결하는 기능 | src/lib/dart-corp-code.ts |
| 공시 목록과 공식 유형, DART 원문 주소를 읽는 기능 | src/lib/dart-disclosure-api.ts |
| 인증키를 서버에서만 읽게 하는 자리 | src/lib/server-env.ts |
| 가져온 외부 자료를 Database에 저장하고 유효시간이 지난 것만 다시 확인하는 기능 | src/lib/api-cache.ts |
| Supabase Database에 연결하는 자리 | src/lib/db.ts |
| 같은 근거와 같은 모델이면 브리핑을 다시 만들지 않게 하는 기능 | src/lib/briefing-cache.ts |
| Upstash Redis에 연결하는 자리 | src/lib/redis.ts |
| 사용량 한도에 도달한 동안 Gemini 호출을 멈추는 기능 | src/lib/gemini-rate-limit.ts |
| 인증키와 연결 정보를 브라우저에서 직접 입력하는 내 컴퓨터 전용 화면 | src/app/setup/ |
| 그 화면을 내 컴퓨터에서 연 경우에만 열리게 막는 기준 | src/lib/local-request.ts, src/proxy.ts |
| 입력한 값을 Git에서 제외된 .env.local에 저장하는 기능 | src/lib/env-file.ts, src/lib/secret-fields.ts |
| 오류 메시지에 인증키나 연결 문자열이 섞여 나가지 않게 가리는 기능 | src/lib/redact.ts |
| 기준일과 순위 조건, 공시 조회, 브리핑 근거와 결과 확인, 저장한 값의 재사용, 인증키 노출을 확인하는 Test | tests/ |
| 브리핑 버튼부터 근거와 출처까지 눌러보는 Test | tests/e2e/ai-briefing-flow.spec.ts |
| 시장 화면에서 종목 화면과 차트까지 눌러보는 Test | tests/e2e/market-flow.spec.ts |
| 실제 주식시세정보 응답을 직접 확인하는 도구 | scripts/verify-stock-price-api.ts |
| 실제 공시 응답을 직접 확인하는 도구 | scripts/verify-dart-disclosure-api.ts |
| Supabase와 Upstash 연결을 각각 확인하는 도구 | scripts/verify-supabase-connection.ts, scripts/verify-upstash-connection.ts |
| 유효시간이 지난 저장값을 정리하는 도구 | scripts/cleanup-expired-cache.ts |

인증키는 들어 있지 않습니다. .env.local.example을 보고 자기 인증키를 넣으면 됩니다.
주식시세정보와 지수시세정보, KRX상장종목정보 세 API가 공공데이터포털 인증키 하나를 함께
사용하고, 공시는 OpenDART 인증키, 브리핑은 Google AI Studio의 Gemini API Key를 따로
사용합니다. Database와 Cache는 Supabase 연결 문자열과 Upstash Redis의 주소·Token을
사용합니다.

이 프로젝트의 Test는 실제 금융위원회와 OpenDART 응답, 실제 Gemini 호출까지 확인하므로,
Test를 실행하려면 자기 인증키가 필요합니다.

인증키와 연결 정보는 서버에서만 사용합니다. 브라우저가 받아가는 파일에는 이름도 값도
들어가지 않습니다.

## Claude Code에서 이어서 사용하기

이 폴더를 Claude Code에서 열고 그대로 입력하면 됩니다.

```text
이 폴더는 책 12장을 끝낸 상태의 프로젝트야.
실행에 필요한 환경이 준비되어 있는지 확인하고, 없으면 준비해줘.
내 인증키와 Database, Cache 접속 정보를 넣을 자리를 알려주고
Test를 실행해서 결과를 보여줘.
그다음 같은 종목을 두 번 열어 두 번째가 더 빠른지 확인할 방법도 알려줘.
```

## 내 결과와 달라도 괜찮습니다

같은 요청문을 입력해도 파일 이름과 함수 이름, 화면 모양은 달라집니다. AI가 만드는 문장은
같은 자료로도 매번 달라지고, 화면에 보이는 숫자는 실행하는 날의 데이터에 따라 달라집니다.
응답시간도 컴퓨터와 네트워크, 서비스 상태에 따라 달라집니다. 기준은 코드나 문장이 같은지가
아니라 12장의 완료 조건을 만족하는지입니다.

- 같은 주식 데이터를 다시 요청하면 금융위원회를 다시 부르지 않습니다.
- 유효시간이 지난 값은 저장된 것을 쓰지 않고 원본에서 다시 확인합니다.
- 같은 근거와 같은 모델이면 저장된 브리핑을 그대로 돌려줍니다.
- 근거나 모델이 바뀌면 이전 브리핑을 쓰지 않고 새로 만듭니다.
- 사용량 한도에 도달한 동안에는 추가 호출이 나가지 않습니다.
- 빨라진 뒤에도 11장에서 정한 근거 안의 설명 기준이 그대로 유지됩니다.
- 인증키와 연결 정보가 브라우저로 전달되지 않고 오류 화면에도 나오지 않습니다.

## 검증 결과

빈 폴더에 이 Source만 놓고 준비와 Test 실행까지 확인했습니다. Test 113개가 모두
통과했고 그중 13개가 12장에서 새로 생겼습니다. 근거는
[verification/chapter-12/](../../../../verification/chapter-12/)에 있습니다.

Database와 Cache 연결값은 로컬과 Vercel에 같은 이름으로 등록합니다: SUPABASE_DATABASE_URL, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN. 연동 서비스가 다른 이름으로 등록한 값도 이 세 이름으로 맞추며, 실제 값은 대화나 Git에 남기지 않습니다.
