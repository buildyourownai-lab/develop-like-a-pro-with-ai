# 1장. 영화 흥행 기록으로 첫 Excel 보고서를 만들어봅니다

## 이 장을 시작할 때

[Study AI Lab MCP 연결](https://www.studyailab.com/develop/mcp#connect) 후 개발 AI에게 **“1장 시작해”**라고 요청하세요. 별도 튜터 설치는 필요하지 않습니다. AI가 현재 장·판본·작업 폴더를 확인하고 다음 행동 하나를 안내합니다. 책 작업 공간 안의 `movie-report`에서 첫 보고서를 직접 만듭니다. Python과 필요한 환경이 아직 없으면 이 장의 환경 준비부터 진행합니다.

요청문·힌트 조회는 실행이나 완료 확인과 다릅니다. 실제 작업과 진도는 내 컴퓨터에서 확인하며, 필요한 [로컬 지원 파일](https://www.studyailab.com/develop/mcp#support-files)의 명령 옵션은 AI가 처리합니다. 아래 기존 검증 기록은 새 MCP 경로의 장별 전체 재현 완료를 뜻하지 않습니다.

## 이 장에서 만드는 것

이 장을 끝내면 movie-report-2024.xlsx 파일 하나가 생깁니다. 공식 KOBIS 자료를 찾아
2024년 영화 흥행 기록을 정리한 Excel 보고서입니다.

![완성된 movie-report-2024.xlsx의 차트 시트 --- 표에 있는 관객수·매출액 셀을 참조해 그려진 차트를 확인합니다.](../../assets/chapter-01/movie-report-2024-chart-sheet.png)

저자가 실제로 만든 파일을
[여기서 내려받아 열어보실 수 있습니다](../../verification/chapter-01/artifacts/movie-report-2024.xlsx).
그 파일은 시트 4개로 이루어져 있습니다.

| 시트 | 내용 |
|---|---|
| TOP20 | 순위·영화명·개봉일·관객수·매출액 20행과 합계 행 |
| 차트 | 관객수·매출액 막대 차트 2개. TOP20 시트의 실제 셀을 참조합니다 |
| 요약 | 조회 조건과 핵심 요약. 각 항목에 산출 방식이 함께 적혀 있습니다 |
| 출처 | 조회 URL·기준 연도·수집 일시·재확인 방법 |

시트 이름과 표가 시작하는 행은 실행할 때마다 달라집니다. 여러분의 보고서가 이 파일과
다르게 생겼어도 괜찮습니다. 책 1장의 확인 목록 7개가 보이면 제대로 만들어진 것입니다.

## 프롬프트

[prompts.md](prompts.md)에 1장에서 Claude Code에 입력하는 문장이 책의 순서대로 있습니다.

## 장별 Source

[source/movie-report/](source/movie-report/)는 1장을 끝낸 상태의 프로젝트입니다. 실습이
잘 진행되는 동안 먼저 열어보는 정답지가 아니라, 아래 복구 방법으로도 해결하지 못했을 때
다음 장부터 이어가기 위한 마지막 수단입니다.

## 검증 결과

[Development Lab의 검증 요약](https://www.studyailab.com/develop/chapters/01#sources)과 [공개 검증 자료](../../verification/chapter-01/)를 확인하세요.

## 막혔을 때

[Development Lab의 도움말](https://www.studyailab.com/develop/chapters/01#help)을 확인하세요. 실습 Source는 현재 작업을 보존한 뒤 복구의 마지막 수단으로 사용합니다.
