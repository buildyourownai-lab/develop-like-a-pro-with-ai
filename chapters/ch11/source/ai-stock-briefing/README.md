# 11장을 끝낸 상태의 ai-stock-briefing

## 이 Source는 언제 사용하나요?

금융위원회 공식 주식 데이터로 시장 화면과 종목 화면, 최근 1년 차트를 만들고, 금융감독원
OpenDART의 공시를 붙인 뒤, 그 자료만 근거로 Gemini가 한국어 브리핑을 만드는 상태입니다.
정답지가 아닙니다.

책을 따라가다 막혔을 때 순서는 이렇습니다.

```text
디버깅 → 내 정상 기록으로 복구 → 장별 Source로 재시작
```

이 Source는 마지막 단계입니다. 앞의 두 방법으로도 이어갈 수 없을 때, 12장부터 계속
진행하기 위해 사용합니다. 이 Source로 시작하면 11장의 남은 실습은 건너뛰게 됩니다.

9장부터 11장까지 만든 파일이 모두 들어 있습니다. 6~8장의 아파트 프로젝트는
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
| 기준일과 순위 조건, 공시 조회, 브리핑 근거와 결과 확인, 인증키 노출을 확인하는 Test | tests/ |
| 브리핑 버튼부터 근거와 출처까지 눌러보는 Test | tests/e2e/ai-briefing-flow.spec.ts |
| 시장 화면에서 종목 화면과 차트까지 눌러보는 Test | tests/e2e/market-flow.spec.ts |
| 실제 주식시세정보 응답을 직접 확인하는 도구 | scripts/verify-stock-price-api.ts |
| 실제 공시 응답을 직접 확인하는 도구 | scripts/verify-dart-disclosure-api.ts |

인증키는 들어 있지 않습니다. .env.local.example을 보고 자기 인증키를 넣으면 됩니다.
주식시세정보와 지수시세정보, KRX상장종목정보 세 API가 공공데이터포털 인증키 하나를 함께
사용하고, 공시는 OpenDART 인증키, 브리핑은 Google AI Studio의 Gemini API Key를 따로
사용합니다.

이 프로젝트의 Test는 실제 금융위원회와 OpenDART 응답, 실제 Gemini 호출까지 확인하므로,
Test를 실행하려면 자기 인증키가 필요합니다.

인증키는 서버에서만 사용합니다. 브라우저가 받아가는 파일에는 인증키 이름도 값도 들어가지
않습니다.

## Claude Code에서 이어서 사용하기

이 폴더를 Claude Code에서 열고 그대로 입력하면 됩니다.

```text
이 폴더는 책 11장을 끝낸 상태의 프로젝트야.
실행에 필요한 환경이 준비되어 있는지 확인하고, 없으면 준비해줘.
내 인증키를 넣을 자리를 알려주고 Test를 실행해서 결과를 보여줘.
그다음 브라우저에서 종목 화면의 AI 브리핑까지 확인할 방법도 알려줘.
```

## 내 결과와 달라도 괜찮습니다

같은 요청문을 입력해도 파일 이름과 함수 이름, 화면 모양은 달라집니다. AI가 만드는 문장은
같은 자료로도 매번 달라지고, 화면에 보이는 숫자는 실행하는 날의 데이터에 따라 달라집니다.
기준은 코드나 문장이 같은지가 아니라 11장의 완료 조건을 만족하는지입니다.

- 종목 화면에서 버튼을 눌렀을 때만 브리핑이 만들어집니다.
- 프로그램이 확인한 사실과 AI가 정리한 설명이 화면에서 나뉘어 보입니다.
- 현재가와 기간 등락, 최고가와 최저가, 거래일 수, 공시 건수는 프로그램이 계산한
  값입니다.
- 현재 근거만으로 알 수 없는 것이 따로 표시되고, 투자 판단이나 목표주가, 미래 예측은
  나오지 않습니다.
- 사용한 출처와 기준일이 함께 보이고, 공시에서 DART 원문으로 내려갈 수 있습니다.
- Gemini 호출이 실패해도 가격과 차트, 공시는 그대로 보입니다.
- API Key가 브라우저로 전달되지 않고 오류 화면에도 나오지 않습니다.

## 검증 결과

빈 폴더에 이 Source만 놓고 준비와 Test 실행까지 확인했습니다. Test 100개가 모두
통과했고 그중 52개가 11장에서 새로 생겼습니다. 근거는
[verification/chapter-11/](../../../../verification/chapter-11/)에 있습니다.
