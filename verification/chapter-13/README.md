# 13장 검증 --- 앱을 만들기 전에 어디까지 만들지 먼저 정했습니다

> **12장을 끝낸 프로젝트에서 13장 요청문만으로 다음 두 장이 그대로 꺼내 쓸 계획까지 도달**
> 완료 기준 9개 전부 통과 · 프로젝트 전체 Test 113개 통과(이 장에서 새로 생긴 것 없음)
> 최종 확인 2026-08-31

## 실제로 만들어봤습니다

책에 인쇄된 요청문만으로, 앱 코드를 만들지 않고 Android와 iPhone 작업의 범위를 정할 수
있는지 확인했습니다.

- 요청문은 책 13장에 나오는 문장을 **글자까지 그대로** 썼습니다.
- 13장은 12장을 이어가는 장이므로 **12장을 끝낸 프로젝트**에서 시작했습니다.
- **책에 없는 추가 지시를 보태지 않았습니다.**

13장의 완료 기준은 계획에 무엇이 들어가야 하는지입니다. **전부 통과했습니다.**

| | 확인 항목 | 결과 |
|---:|---|---|
| 1 | 앱을 만드는 목적이 적혀 있다 | 통과 |
| 2 | 첫 앱에 넣을 기능과 뺄 기능이 갈려 있다 | 통과 |
| 3 | 작은 화면에서 무엇을 먼저 볼지 순서가 정해져 있다 | 통과 |
| 4 | 주식 데이터·공시·AI 브리핑·Database·Cache를 기존 서버에서 재사용한다고 적혀 있다 | 통과 |
| 5 | 앱에 넣지 않을 Secret과 요청하지 않을 기기 권한이 적혀 있다 | 통과 |
| 6 | Android와 iPhone에 공통으로 적용할 완료 조건이 사람의 사용 흐름으로 적혀 있다 | 통과 |
| 7 | 이번에 검증하지 않을 범위가 적혀 있다 | 통과 |
| 8 | 계획이 실제 구현과 모순되지 않는다 | 통과 |
| 9 | 정한 계획이 Git 기록에 남고 작업 폴더가 깨끗해진다 | 통과 |

계획 문서의 파일 이름과 문장, 항목을 나눈 방식은 매번 달라집니다. 그래서 확인한 것은 책과
같은 문서가 나오는지가 아니라 **위 아홉 가지가 다음 장으로 넘어갈 수 있는 상태로 정해지는지**
입니다.

8번은 Claude가 계획을 현재 프로젝트와 다시 대조한 결과입니다. 없는 기능을 이미 있다고 쓴
곳, 제외한 로그인과 알림을 다른 곳에서 전제한 곳, Secret이 앱으로 들어가는 방향은 없었습니다.

## 완성된 결과를 공개합니다

| 무엇 | 어디 |
|---|---|
| 13장을 끝낸 프로젝트 | [chapters/ch13/source/ai-stock-briefing/](../../chapters/ch13/source/ai-stock-briefing/) |
| 13장 요청문 | [chapters/ch13/prompts.md](../../chapters/ch13/prompts.md) |
| 다음 두 장에서 사용할 계획 | [docs/mobile-app-plan.md](../../chapters/ch13/source/ai-stock-briefing/docs/mobile-app-plan.md) |
| 빈 폴더에서 돌린 Test 실행 결과 | [artifacts/source-test-run.txt](artifacts/source-test-run.txt) |

이 장은 코드를 바꾸지 않으므로 12장 상태와 비교하면 계획 문서 하나가 더해졌습니다.

## 자동 검사도 해봤습니다

| | 개수 |
|---|---:|
| 13장 Source에서 돌린 검사 전체 | 113개 |
| 이 장에서 새로 생긴 검사 | 없음 |

돌린 검사 코드는 13장 Source의
[tests/](../../chapters/ch13/source/ai-stock-briefing/tests/) 안에 있습니다. 앱 코드를
만들지 않는 장이므로 새 검사는 없고, 9장부터 12장까지 만든 검사를 계획을 정한 뒤에도 그대로
다시 돌려 기존 웹 기능이 그대로인 것을 확인했습니다.

| 무엇을 확인하는가 | 어디 |
|---|---|
| 시장 기준일과 등락률 순위 조건 | [tests/market-data.test.ts](../../chapters/ch13/source/ai-stock-briefing/tests/market-data.test.ts), [tests/latest-trading-date.test.ts](../../chapters/ch13/source/ai-stock-briefing/tests/latest-trading-date.test.ts) |
| 종목 검색과 공시 조회 | [tests/stock-lookup.test.ts](../../chapters/ch13/source/ai-stock-briefing/tests/stock-lookup.test.ts), [tests/dart-disclosure.test.ts](../../chapters/ch13/source/ai-stock-briefing/tests/dart-disclosure.test.ts) |
| AI 브리핑의 근거와 결과 확인, 저장한 값의 재사용 | [tests/briefing-facts.test.ts](../../chapters/ch13/source/ai-stock-briefing/tests/briefing-facts.test.ts), [tests/briefing-verify.test.ts](../../chapters/ch13/source/ai-stock-briefing/tests/briefing-verify.test.ts), [tests/briefing-actions.test.ts](../../chapters/ch13/source/ai-stock-briefing/tests/briefing-actions.test.ts), [tests/gemini-briefing-api.test.ts](../../chapters/ch13/source/ai-stock-briefing/tests/gemini-briefing-api.test.ts) |
| 인증키와 연결 정보가 밖으로 나가지 않는 것 | [tests/server-only-key.test.ts](../../chapters/ch13/source/ai-stock-briefing/tests/server-only-key.test.ts) |
| 화면을 실제로 눌러보는 흐름 | [tests/e2e/](../../chapters/ch13/source/ai-stock-briefing/tests/e2e/) |

장별 Source를 빈 폴더에 단독으로 놓고 준비와 빌드, Test 실행까지 했습니다. 전체 검사 목록과
실행 결과는 [artifacts/source-test-run.txt](artifacts/source-test-run.txt)에 있습니다.

## 직접 확인해볼 수 있습니다

만들어보실 때는 책의 13장을 그대로 따라 하시면 됩니다. 요청문은
[chapters/ch13/prompts.md](../../chapters/ch13/prompts.md)에 책에 나오는 순서대로
있습니다.

내 계획에 빠진 것이 없는지 항목별로 확인할 수 있습니다.

```text
지금 계획 문서에 목적, 넣을 기능과 뺄 기능, 화면 순서, 기존 서버 재사용,
Secret과 개인정보와 기기 권한, 공통 완료 조건, 검증하지 않을 범위가
각각 들어 있는지 하나씩 확인해서 알려줘.
```

계획이 실제 구현과 어긋나지 않는지도 다시 대조할 수 있습니다.

```text
계획을 현재 프로젝트와 대조해줘.
없는 기능을 이미 있다고 쓴 곳, 제외한 기능을 전제한 곳,
Secret이 앱으로 들어가는 방향이 있는지 확인해서 알려줘.
```

13장 Source를 받아 자기 인증키와 접속 정보를 넣으면 같은 검사를 그대로 돌려볼 수 있습니다.

```text
이 폴더는 책 13장을 끝낸 상태의 프로젝트야.
내 인증키와 Database, Cache 접속 정보를 넣을 자리를 알려주고
Test를 전부 실행해서 결과를 보여줘.
```

## 이런 한계가 있습니다

- **이 장에는 앱이 없습니다.** 13장의 결과물은 계획 문서이고, 실제 Android 앱은 14장,
  iPhone 앱은 15장에서 만듭니다.
- **계획은 그대로 구현된다는 보장이 아닙니다.** 내부 구조와 기술 선택은 다음 두 장에서
  실제로 만들면서 결정되고, 그때 계획을 고치게 될 수도 있습니다.
- **문서의 문장과 구성은 매번 달라집니다.** 같은 요청문을 넣어도 항목을 나눈 방식과 표현이
  달라지므로, 파일을 나란히 비교하지 말고 위 아홉 가지가 들어갔는지로 판단합니다.
- **완료 범위를 사람이 정한 결과입니다.** 로그인·관심종목·알림·매매·포트폴리오를 빼기로 한
  것은 이 책의 결정이며, 다른 범위를 정하면 다음 두 장의 확인 항목도 달라집니다.
