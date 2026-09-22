# 15장 검증 --- 같은 웹서비스를 실제 iPhone 앱에서 끝까지 사용했습니다

> **14장을 끝낸 프로젝트에서 15장 요청문만으로 공식 iPhone Simulator의 앱까지 도달**
> 완료 기준 9개 전부 통과 · 프로젝트 전체 Test 165개 통과(이 장에서 새로 생긴 것 29개)
> 최종 확인 2026-08-31

## 실제로 만들어봤습니다

책에 인쇄된 요청문만으로, 기존 주식 웹서비스가 실제 iPhone 앱에서도 그대로 동작하는지
확인했습니다.

- 요청문은 책 15장에 나오는 문장을 **글자까지 그대로** 썼습니다.
- 15장은 14장을 이어가는 장이므로 **14장을 끝낸 프로젝트**에서 시작했습니다.
- **책에 없는 추가 지시를 보태지 않았습니다.**
- 앱을 만든 뒤 Apple 공식 Simulator(iPhone 17 Pro, iOS 26.3)에 설치해 **사람이 직접 화면을
  눌러가며** 확인했습니다.

15장의 완료 기준은 앱을 열어 무엇을 할 수 있는지입니다. **전부 통과했습니다.**

| | 확인 항목 | 결과 |
|---:|---|---|
| 1 | 공식 Simulator에 앱이 설치되고 첫 화면이 실제 서버 자료로 채워진다 | 통과 |
| 2 | 시장 기준일과 코스피·코스닥, 상승률 상위가 보인다 | 통과 |
| 3 | 종목명이나 종목코드로 검색해 상세 화면으로 들어간다 | 통과 |
| 4 | 1개월·3개월·1년 차트와 거래량을 본다 | 통과 |
| 5 | 최근 공시에서 DART 공식 원문이 Safari로 열린다 | 통과 |
| 6 | AI 브리핑의 근거와 출처, 알 수 없는 것이 웹과 같은 항목으로 나온다 | 통과 |
| 7 | Release 앱이 Production HTTPS 주소를 사용하고 네트워크 보안을 낮추지 않았다 | 통과 |
| 8 | 완성된 앱에 외부 서비스 Secret이 없고 필요하지 않은 기기 권한을 요청하지 않는다 | 통과 |
| 9 | 기존 웹 기능과 Android 앱 기능이 그대로 동작한다 | 통과 |

앱의 화면 배치와 파일 이름, 내부 구조는 매번 달라집니다. 그래서 확인한 것은 책과 같은
코드가 나오는지가 아니라 **위 아홉 가지를 실제 Simulator에서 할 수 있는지**입니다.

Android 앱을 다시 만들거나 주식 서비스를 복사하지 않았습니다. 주식 데이터와 공시, Gemini,
Database와 Cache는 14장까지 만든 서버 기능을 그대로 씁니다. 이 장에서 더해진 것은 iPhone
화면과 그 화면이 서버를 부르는 부분입니다.

## 완성된 결과를 공개합니다

| 무엇 | 어디 |
|---|---|
| 15장을 끝낸 프로젝트 | [chapters/ch15/source/ai-stock-briefing/](../../chapters/ch15/source/ai-stock-briefing/) |
| 15장 요청문 | [chapters/ch15/prompts.md](../../chapters/ch15/prompts.md) |
| iPhone 앱 프로젝트 | [ios/](../../chapters/ch15/source/ai-stock-briefing/ios/) |
| 앱이 자료를 받아가는 서버 자리 | [src/app/api/](../../chapters/ch15/source/ai-stock-briefing/src/app/api/) |
| 빈 폴더에서 돌린 Test 실행 결과 | [artifacts/source-test-run.txt](artifacts/source-test-run.txt) |

14장 상태와 비교하면 iPhone 앱 프로젝트와 그 앱을 확인하는 검사가 더해졌습니다. 서버와
Android 앱, 웹 화면은 14장과 같습니다.

## 자동 검사도 해봤습니다

| | 개수 |
|---|---:|
| 15장 Source에서 돌린 검사 전체 | 165개 |
| 이 장에서 새로 생긴 검사 | 29개 |

돌린 검사 코드는 15장 Source 안에 있습니다. 웹서비스 검사는
[tests/](../../chapters/ch15/source/ai-stock-briefing/tests/), Android 앱 검사는
[android/app/src/test/](../../chapters/ch15/source/ai-stock-briefing/android/app/src/test/),
iPhone 앱 검사는
[ios/AiStockBriefingTests/](../../chapters/ch15/source/ai-stock-briefing/ios/AiStockBriefingTests/)와
[ios/AiStockBriefingUITests/](../../chapters/ch15/source/ai-stock-briefing/ios/AiStockBriefingUITests/)
입니다.

| 무엇을 확인하는가 | 어디 | 새로 생긴 것 |
|---|---|---:|
| 앱이 서버 응답을 웹 화면과 같은 항목으로 읽어내는지 | [ios/AiStockBriefingTests/ModelDecodingTests.swift](../../chapters/ch15/source/ai-stock-briefing/ios/AiStockBriefingTests/ModelDecodingTests.swift) | 7개 |
| 앱이 숫자와 등락을 웹·Android와 같은 규칙으로 표시하는지 | [ios/AiStockBriefingTests/FormattersTests.swift](../../chapters/ch15/source/ai-stock-briefing/ios/AiStockBriefingTests/FormattersTests.swift) | 9개 |
| 검색 주소와 오류 안내가 사람이 읽는 말로 나오는지 | [ios/AiStockBriefingTests/ApiClientTests.swift](../../chapters/ch15/source/ai-stock-briefing/ios/AiStockBriefingTests/ApiClientTests.swift) | 5개 |
| 공시 제출인을 웹 화면과 같은 형식으로 표시하는지 | [ios/AiStockBriefingTests/DisclosureUiTests.swift](../../chapters/ch15/source/ai-stock-briefing/ios/AiStockBriefingTests/DisclosureUiTests.swift) | 2개 |
| AI 브리핑의 근거와 출처, 알 수 없는 것이 남아 있는지 | [ios/AiStockBriefingTests/AiBriefingSectionTests.swift](../../chapters/ch15/source/ai-stock-briefing/ios/AiStockBriefingTests/AiBriefingSectionTests.swift) | 3개 |
| Simulator에서 첫 화면과 검색 흐름이 실제로 열리는지 | [ios/AiStockBriefingUITests/AiStockBriefingUITests.swift](../../chapters/ch15/source/ai-stock-briefing/ios/AiStockBriefingUITests/AiStockBriefingUITests.swift) | 3개 |
| 9~14장에서 만든 기존 웹·Android 기능이 그대로인지 | [tests/](../../chapters/ch15/source/ai-stock-briefing/tests/), [android/app/src/test/](../../chapters/ch15/source/ai-stock-briefing/android/app/src/test/) | --- |

장별 Source를 빈 폴더에 단독으로 놓고 준비와 빌드, Test 실행까지 했습니다. 전체 실행
결과는 [artifacts/source-test-run.txt](artifacts/source-test-run.txt)에 있습니다.

검사 코드와 별도로 저자가 직접 돌려 확인한 것도 있습니다.

- 공식 Simulator에 앱을 설치해 시장·검색·차트·공시·AI 브리핑 흐름을 화면을 눌러가며 확인
- 공시의 DART 원문 열기를 눌러 Safari가 dart.fss.or.kr 원문을 여는 것 확인
- Release로 만든 앱이 Vercel Production HTTPS 주소에서 실제 시장 자료를 받는 것 확인
- 실제 배포 서버 응답으로 지수 2개, 종목코드, 일별 시세 건수, 공시 원문 주소, 브리핑 근거를
  대조
- 완성된 앱과 저장소에서 외부 서비스 Secret과 필요하지 않은 기기 권한을 다시 검사

## 공식 자료와 비교했습니다

앱이 보여주는 숫자가 웹서비스와 공식 자료의 값과 같은지 대조했습니다. 아래는 주식시세
기준일 **2026-08-28**의 값입니다.

| 무엇 | 앱 화면 | 대조한 곳 |
|---|---|---|
| 코스피 | 6,789 (-1.79%) | 금융위원회 지수시세정보 |
| 코스닥 | 838 (+0.09%) | 금융위원회 지수시세정보 |
| SK하이닉스 종가 | 1,653,000원 (기준가 대비 -4.45%) | 금융위원회 주식시세정보 |
| 최근 1년 거래일 | 244일 | 금융위원회 주식시세정보 |
| 최근 1년 접수 공시 | 478건 | 금융감독원 OpenDART |

시세와 공시는 계속 늘어나므로 나중에 확인하면 숫자가 달라집니다. 대조한 것은 값 자체가
아니라 **앱이 웹서비스와 같은 기준일의 같은 숫자를 보여주는지**입니다. AI 브리핑에서도
시장과 종목 비교, 최근 가격 흐름, 회사 공시가 웹과 같은 항목으로 나왔습니다.

공시는 앱에서 요약을 읽고 끝나지 않고 한 건마다 DART 원문으로 내려갈 수 있습니다. 실제로
원문을 열어 금융감독원 전자공시시스템의 공식 문서가 나오는 것을 확인했습니다.

## 직접 확인해볼 수 있습니다

만들어보실 때는 책의 15장을 그대로 따라 하시면 됩니다. 요청문은
[chapters/ch15/prompts.md](../../chapters/ch15/prompts.md)에 책에 나오는 순서대로
있습니다.

내 iPhone 앱이 웹서비스와 Android 앱과 같은 것을 보여주는지 대조할 수 있습니다.

```text
같은 종목에서 웹 화면과 Android 화면, iPhone 화면이 보여주는 항목과 숫자를 대조해줘.
어느 한 곳에서 빠지거나 줄여서 표시되는 것이 있으면 알려줘.
```

앱에 Secret이나 필요하지 않은 권한이 들어가지 않았는지도 확인할 수 있습니다.

```text
완성한 iPhone 앱과 저장소에 외부 서비스 Secret이 들어 있지 않은지 검사해줘.
이번 기능에 필요하지 않은 기기 권한을 요청하지 않는지도 확인해줘.
실제 Secret 값은 출력하지 말고 발견 여부와 사용하는 권한만 알려줘.
```

15장 Source를 받아 자기 인증키와 접속 정보를 넣으면 같은 검사를 그대로 돌려볼 수 있습니다.

```text
이 폴더는 책 15장을 끝낸 상태의 프로젝트야.
내 인증키와 Database, Cache 접속 정보를 넣을 자리를 알려주고
웹서비스와 Android 앱, iPhone 앱의 Test를 전부 실행해서 결과를 보여줘.
```

## 이런 한계가 있습니다

- **공식 Simulator에서 확인한 결과입니다.** Simulator는 Apple이 제공하는 공식 iOS 환경이지만
  실물 iPhone에는 앱 서명과 기기 연결, 기기별 화면과 성능 조건이 더해집니다.
- **App Store 등록은 이 장의 범위가 아닙니다.** Store 공개에는 Apple Developer Program과
  비용, 인증서와 서명, App Store Connect, 개인정보 표시와 그때의 심사 정책 확인이 따로
  필요합니다.
- **이 장은 Mac에서 진행합니다.** iPhone 앱을 만드는 Xcode는 Apple이 macOS에만 제공합니다.
- **화면과 숫자는 매번 달라집니다.** 시세와 공시는 거래일마다 새로 들어오고, AI 브리핑의
  문장도 실행할 때마다 조금씩 달라집니다. 같은 것은 기준일과 항목, 그리고 숫자가 공식
  자료와 일치한다는 점입니다.
- **투자 판단은 제공하지 않습니다.** iPhone 앱도 웹서비스와 같이 목표주가·주가 예측·매수·매도
  판단을 만들지 않습니다.
