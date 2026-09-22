# 11장 검증 --- 확인된 근거만 주고 AI가 그 안에서 설명하게 했습니다

> **10장을 끝낸 프로젝트에서 11장 요청문만으로 근거 있는 AI 브리핑까지 도달**
> 프로젝트 전체 Test 102개 통과(이 장에서 새로 생긴 것 54개) · 실제 Gemini 호출로 확인
> 최종 확인 2026-08-31

## 실제로 만들어봤습니다

책에 인쇄된 요청문만으로 9~10장에서 만든 주식 화면에 AI 브리핑을 붙일 수 있는지
확인했습니다.

- 요청문은 책 11장에 나오는 문장을 **글자까지 그대로** 썼습니다.
- 11장은 10장을 이어가는 장이므로 **10장을 끝낸 프로젝트**에서 시작했습니다.
- **책에 없는 추가 지시를 보태지 않았습니다.**

11장의 완료 기준은 여섯 가지입니다. **전부 통과했습니다.**

| | 확인 항목 | 결과 |
|---:|---|---|
| 1 | 브리핑에 나오는 사실이 모두 그 화면의 시세·지수·공시 자료 안에 있다 | 통과 |
| 2 | 프로그램이 계산한 사실과 AI가 정리한 설명이 화면에서 나뉘어 보인다 | 통과 |
| 3 | 현재가와 1년간 변동률, 최고가·최저가, 공시 건수는 프로그램이 계산한 값이다 | 통과 |
| 4 | 현재 근거만으로 알 수 없는 것이 따로 표시되고 투자 판단·목표주가가 나오지 않는다 | 통과 |
| 5 | 근거 밖의 숫자나 인과관계가 섞인 답은 화면에 나오지 않고 걸러진다 | 통과 |
| 6 | Gemini 호출이 실패해도 가격과 차트, 공시는 그대로 보인다 | 통과 |

AI가 만드는 문장은 같은 자료로도 매번 달라집니다. 그래서 문장이 같은지가 아니라
**브리핑이 우리가 준 근거 안에 머무는지**를 확인했습니다.

## 완성된 결과를 공개합니다

| 무엇 | 어디 |
|---|---|
| 11장을 끝낸 프로젝트 | [chapters/ch11/source/ai-stock-briefing/](../../chapters/ch11/source/ai-stock-briefing/) |
| 11장 요청문 | [chapters/ch11/prompts.md](../../chapters/ch11/prompts.md) |
| Gemini에게 건넨 근거와 실제로 받은 브리핑 | [artifacts/briefing-facts-and-ai-summary.txt](artifacts/briefing-facts-and-ai-summary.txt) |
| 조건을 어긴 답을 넣어본 결과 | [artifacts/grounding-rejection-cases.txt](artifacts/grounding-rejection-cases.txt) |
| Gemini 호출이 실패했을 때의 화면 | [artifacts/gemini-failure-fallback.txt](artifacts/gemini-failure-fallback.txt) |
| 빈 폴더에서 돌린 Test 실행 결과 | [artifacts/source-test-run.txt](artifacts/source-test-run.txt) |

장별 Source를 빈 폴더에 단독으로 놓고 준비와 빌드, Test 실행, 실제 화면 확인까지
했습니다.

## 자동 검사도 해봤습니다

| | 개수 |
|---|---:|
| 11장 Source에서 돌린 검사 전체 | 102개 |
| 이 장에서 새로 생긴 검사 | 54개 |

돌린 검사 코드는 11장 Source 안에 있습니다. 9장과 10장에서 만든 검사도 함께 다시
돌렸습니다.

| 파일 | 무엇을 확인하는가 | 검사 |
|---|---|---:|
| [tests/briefing-facts.test.ts](../../chapters/ch11/source/ai-stock-briefing/tests/briefing-facts.test.ts) | 시장과 종목의 등락률 차이를 부동소수 오차 없이 계산하는 것, 차이 구간 표현이 경계값에서 바뀌는 것, 최근 1년 시작·끝 가격과 변동률, 거래정지로 시가·고가·저가가 0인 날을 최고가·최저가 계산에서 빼는 것, 알 수 없는 것 목록을 AI가 아니라 프로그램이 만드는 것 | 23개 |
| [tests/gemini-briefing-api.test.ts](../../chapters/ch11/source/ai-stock-briefing/tests/gemini-briefing-api.test.ts) | Gemini 요청에 인터넷 검색 도구를 넣지 않는 것, 응답이 없을 때 기다림을 멈추는 것, 오류 응답에 키 값이 섞여 있어도 화면 문구에서 지우는 것, 판정 결과가 형식에 맞지 않으면 통과시키지 않는 것 | 9개 |
| [tests/briefing-verify.test.ts](../../chapters/ch11/source/ai-stock-briefing/tests/briefing-verify.test.ts) | 우리가 주지 않은 숫자를 답에서 찾아내는 것, 근거에 있는 숫자를 잘못 걸러내지 않는 것, 표기 방식이 달라도 같은 숫자로 보는 것 | 8개 |
| [tests/briefing-actions.test.ts](../../chapters/ch11/source/ai-stock-briefing/tests/briefing-actions.test.ts) | 실제 SK하이닉스 시세·지수·공시로 계산한 사실과 실제 Gemini 설명을 함께 돌려주는 것, 근거 밖 숫자나 조건 위반이 있으면 설명을 표시하지 않고 사실만 남기는 것, Gemini가 실패해도 사실은 그대로 돌려주는 것 | 7개 |
| [tests/e2e/ai-briefing-flow.spec.ts](../../chapters/ch11/source/ai-stock-briefing/tests/e2e/ai-briefing-flow.spec.ts) | 버튼을 누르기 전에는 브리핑이 만들어지지 않고 기존 화면이 그대로인 것, 핵심 브리핑에서 알 수 없는 것까지 순서대로 나오는 것, 공시에서 실제 DART 원문이 열리는 것, 목표주가나 매수·매도 권유가 없는 것, 화면과 요청 어디에도 Secret이 없는 것 | 5개 |
| [tests/dart-disclosure.test.ts](../../chapters/ch11/source/ai-stock-briefing/tests/dart-disclosure.test.ts) | 10장에서 만든 공시 조회와 공식 유형, DART 원문 링크 검사 | 25개 |
| [tests/stock-lookup.test.ts](../../chapters/ch11/source/ai-stock-briefing/tests/stock-lookup.test.ts) | 9장에서 만든 종목 검색과 시세, 최근 1년 일별 시세 검사 | 6개 |
| [tests/latest-trading-date.test.ts](../../chapters/ch11/source/ai-stock-briefing/tests/latest-trading-date.test.ts) | 데이터가 있는 거래일을 찾아 거슬러 올라가는 계산 검사 | 5개 |
| [tests/market-data.test.ts](../../chapters/ch11/source/ai-stock-briefing/tests/market-data.test.ts) | 지수와 종목 시세의 기준일, 등락률 순위 조건 검사 | 4개 |
| [tests/server-only-key.test.ts](../../chapters/ch11/source/ai-stock-briefing/tests/server-only-key.test.ts) | 브라우저용 파일에 인증키의 값도 이름도 들어가지 않는 것 | 3개 |
| [tests/e2e/market-flow.spec.ts](../../chapters/ch11/source/ai-stock-briefing/tests/e2e/market-flow.spec.ts) | 시장 화면에서 상세와 차트, 검색까지 눌러보는 검사 | 5개 |

검사는 형식만 보고 끝내지 않고 **실제 Gemini 호출과 실제 금융위원회·OpenDART
응답까지** 확인합니다.

저자는 검사와 별도로 직접 확인했습니다.

| 무엇을 확인했나 | 결과 |
|---|---|
| 실제 브리핑에서 Gemini에게 건넨 근거 | 종목 시세·코스피·코스닥 등락률, 최근 1년 시작·끝 가격과 최고가·최저가, 공시 조회 기간과 전체 건수, 최근 공시 5건, 알 수 없는 것 목록 |
| 화면의 숫자가 프로그램 계산값인지 | 현재가·등락률·1년간 변동률·최고가·최저가·공시 건수 모두 프로그램 계산값 |
| 근거에 없는 숫자를 넣은 답 | 프로그램이 그 숫자를 찾아내 표시하지 않음 |
| 목표주가를 제시한 답 | 표시하지 않음 |
| 매수 의견을 낸 답 | 표시하지 않음 |
| 미래 가격을 예측한 답 | 표시하지 않음 |
| 공시가 주가 상승의 원인이라고 단정한 답 | 표시하지 않음 |
| Gemini API Key만 잘못된 값으로 바꿔 호출을 실패시킨 화면 | 브리핑 영역에만 안내, 상세 시세·차트·공시 그대로, 화면과 HTML 어디에도 키 값 없음 |
| 데스크톱 1440x900과 휴대전화 390x844에서 실제로 브리핑 만들기 | 두 크기 모두 네 영역이 순서대로 보이고 출처와 DART 원문 링크 유지 |

값은 [artifacts/](artifacts/)에 있습니다.

## 공식 자료와 비교했습니다

브리핑의 근거는 모두 공식 자료에서 그대로 가져온 값입니다. Gemini에게 인터넷을
검색하게 하지 않았습니다.

**금융위원회 주식시세정보 · 지수시세정보 (공공데이터포털)**
https://www.data.go.kr

**금융감독원 OpenDART**
https://opendart.fss.or.kr

**Google AI Studio (Gemini API)**
https://aistudio.google.com

정확해야 하는 숫자는 Gemini에게 계산시키지 않습니다. 현재가와 전일 대비 등락률,
최근 1년의 시작·끝 가격과 변동률, 최고가와 최저가, 공시 건수는 프로그램이 계산해
화면에 따로 보여주고, 같은 값을 근거로 Gemini에게 건넵니다.

거래정지 등으로 시가·고가·저가가 0으로 제공된 날은 최고가·최저가 계산에서 뺍니다.
그런 날이 있었다면 몇 일을 뺐는지도 근거에 함께 적습니다.

공시는 회사가 금융감독원 전자공시시스템에 직접 제출한 자료를 요약하거나 다시
분류하지 않고 그대로 씁니다. 브리핑에서도 모든 공시에서 DART 원문으로 내려갈 수
있습니다.

## 직접 확인해볼 수 있습니다

만들어보실 때는 책의 11장을 그대로 따라 하시면 됩니다. 요청문은
[chapters/ch11/prompts.md](../../chapters/ch11/prompts.md)에 책에 나오는 순서대로
있습니다.

11장 Source를 받아 자기 인증키를 넣으면 같은 검사를 그대로 돌려볼 수 있습니다.

```text
이 폴더는 책 11장을 끝낸 상태의 프로젝트야.
내 인증키를 넣을 자리를 알려주고 Test를 전부 실행해서 결과를 보여줘.
```

브리핑에 나온 사실이 정말 우리가 준 근거 안에 있는지 직접 대조할 수 있습니다.

```text
SK하이닉스 AI 브리핑을 만들고, Gemini에게 건넨 근거와 받은 문장을 나란히 보여줘.
문장에 나온 숫자가 모두 근거 안에 있는지 확인해줘.
인증키 값은 출력하지 마.
```

조건을 어긴 답이 정말 걸러지는지도 넣어볼 수 있습니다.

```text
목표주가와 매수 의견, 근거에 없는 숫자를 넣은 답을 결과 확인 단계에 넣어보고
화면에 표시되는지 아닌지 보여줘.
```

Gemini가 실패했을 때 나머지 화면이 남는지도 확인할 수 있습니다.

```text
Gemini API Key만 잘못된 값으로 바꿔 서버를 다시 띄우고 종목 화면을 열어줘.
가격과 차트, 공시가 그대로 보이는지와 화면에 키 값이 없는지 확인해줘.
```

## 이런 한계가 있습니다

- **AI가 만드는 문장은 매번 달라집니다.** 같은 근거로도 표현이 바뀝니다. 확인할 것은
  문장이 같은지가 아니라 브리핑이 근거 안에 머무는지입니다.
- **숫자와 공시는 실행하는 날에 따라 달라집니다.** 거래일 수와 공시 건수는 조회하는
  날의 기간에 따라 바뀝니다.
- **브리핑은 요약입니다.** 최근 1년 공시 가운데 최신 몇 건만 문장에 담기며, 전체
  목록은 공시 화면에 그대로 남아 있습니다.
- **공시 제목만으로 내용을 판단하지 않습니다.** 그래서 모든 공시에서 DART 원문으로
  내려갈 수 있게 두었습니다.
- **같은 시기에 있었다는 것과 원인이라는 것은 다릅니다.** 브리핑은 공시가 주가
  움직임의 원인이라고 말하지 않고, 알 수 없는 것으로 따로 표시합니다.
- **투자 추천이나 목표주가, 주가 예측은 제공하지 않습니다.** 결과 확인 단계에서
  그런 답이 나오면 화면에 보여주지 않습니다.
- **Gemini의 모델과 무료 사용 범위, 호출 한도는 바뀔 수 있습니다.** 사용할 수 있는
  모델과 내 사용량은 Google AI Studio의 공식 안내에서 확인합니다.
