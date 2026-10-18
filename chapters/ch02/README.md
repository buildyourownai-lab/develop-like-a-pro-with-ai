# 2장. Claude가 제대로 만들었는지 확인합니다

## 이 장을 시작할 때

[Study AI Lab MCP 연결](https://www.studyailab.com/develop/mcp#connect) 후 개발 AI에게 **“2장 시작해”**라고 요청하세요. 별도 튜터 설치는 필요하지 않습니다. AI가 현재 장·판본·작업 폴더를 확인하고 다음 행동 하나를 안내합니다. 앞 장에서 만든 `movie-report`와 실제 확인 결과를 이어갑니다. 장이 바뀔 때마다 완성 Source를 새로 복사해 시작하지 않습니다.

요청문·힌트 조회는 실행이나 완료 확인과 다릅니다. 실제 작업과 진도는 내 컴퓨터에서 확인하며, 필요한 [로컬 지원 파일](https://www.studyailab.com/develop/mcp#support-files)의 명령 옵션은 AI가 처리합니다. 아래 기존 검증 기록은 새 MCP 경로의 장별 전체 재현 완료를 뜻하지 않습니다.

## 이 장에서 만드는 것

이 장을 끝내면 1장에서 만든 보고서 옆에 두 가지가 더 생깁니다.

| 만들어지는 것 | 무엇인가 |
|---|---|
| source/kobis-2024-source.xlsx | 보고서를 만들 때 사용한 KOBIS 데이터를 작업 당시 상태로 남긴 기준 자료 |
| tests 폴더 | 보고서가 그 기준 자료와 어긋나지 않았는지 언제든 다시 확인하는 자동 검사 |

핵심은 「Claude가 완료했다고 말한 것」과 「우리가 정한 조건을 실제로 만족한 것」을
구분하는 일입니다. 그래서 먼저 완료 조건을 정하고, 그 조건을 기계가 반복해서
확인하게 만듭니다.

검사 항목의 개수는 실행할 때마다 다릅니다. 저자가 두 번 돌렸을 때 7개와 8개가
나왔습니다. 여러분의 개수가 이와 달라도 괜찮습니다. 정한 조건이 모두 들어 있고
실패한 항목이 없으면 제대로 된 것입니다.

## 프롬프트

[prompts.md](prompts.md)에 2장에서 Claude Code에 입력하는 문장이 책의 순서대로
있습니다.

## 장별 Source

[source/movie-report/](source/movie-report/)에는 2장까지 만든 것이 모두 들어 있습니다.
보고서를 만드는 코드, 기준 자료, 자동 검사가 함께 있어 이 폴더 하나만 받아도 바로
실행됩니다. 실습이 잘 진행되는 동안 먼저 열어보는 정답지가 아니라, 아래 복구 방법으로도
해결하지 못했을 때 다음 장부터 이어가기 위한 마지막 수단입니다.

## 검증 결과

[Development Lab의 검증 요약](https://www.studyailab.com/develop/chapters/02#sources)과 [공개 검증 자료](../../verification/chapter-02/)를 확인하세요.

## 막혔을 때

[Development Lab의 도움말](https://www.studyailab.com/develop/chapters/02#help)을 확인하세요. 실습 Source는 현재 작업을 보존한 뒤 복구의 마지막 수단으로 사용합니다.
