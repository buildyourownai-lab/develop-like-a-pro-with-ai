# 4장. 같은 실수는 두 번 하지 않게 합니다

## 이 장을 시작할 때

[Study AI Lab MCP 연결](https://www.studyailab.com/develop/mcp#connect) 후 개발 AI에게 **“4장 시작해”**라고 요청하세요. 별도 튜터 설치는 필요하지 않습니다. AI가 현재 장·판본·작업 폴더를 확인하고 다음 행동 하나를 안내합니다. 앞 장에서 만든 `movie-report`와 실제 확인 결과를 이어갑니다. 장이 바뀔 때마다 완성 Source를 새로 복사해 시작하지 않습니다.

요청문·힌트 조회는 실행이나 완료 확인과 다릅니다. 실제 작업과 진도는 내 컴퓨터에서 확인하며, 필요한 [로컬 지원 파일](https://www.studyailab.com/develop/mcp#support-files)의 명령 옵션은 AI가 처리합니다. 아래 기존 검증 기록은 새 MCP 경로의 장별 전체 재현 완료를 뜻하지 않습니다.

## 이 장에서 만드는 것

3장에서 찾은 문제 해결 방식을 다음에도 반복해서 지킬 규칙으로 남깁니다. 세 파일이
자리를 잡습니다.

| 위치 | 담기는 것 |
|---|---|
| ~/.claude/CLAUDE.md | 모든 프로젝트에서 참고할 공통 작업 원칙 |
| movie-report/CLAUDE.md | 영화 보고서 프로젝트에서만 참고할 규칙 |
| movie-report/docs/debug-procedure.md | 문제가 생겼을 때 따르는 자세한 확인 절차 |

그다음부터는 제목 변경처럼 작은 요청만 해도 Claude가 공통 작업 원칙을 참고해 관련
Test를 스스로 실행하고 전부 통과를 확인한 뒤 완료를 보고합니다. 세 파일의 소제목과
문장은 실행마다 달라집니다. 기준은 문장이 같은지가 아니라 공통 원칙과 프로젝트 규칙이
중복 없이 나뉘었는지입니다.

## 프롬프트

[prompts.md](prompts.md)에 4장에서 Claude Code에 입력하는 문장이 책의 순서대로
있습니다.

## 장별 Source

[source/movie-report/](source/movie-report/)에 4장을 끝낸 상태가 모두 있습니다. 정상
흐름에서 먼저 열어보는 정답지가 아니라, 아래 복구 방법으로도 해결하지 못했을 때 5장부터
계속 진행하기 위한 마지막 복구 수단입니다. 공통 ~/.claude/CLAUDE.md는 이 프로젝트 안의
파일이 아니므로 여기에 없습니다.

## 검증 결과

[Development Lab의 검증 요약](https://www.studyailab.com/develop/chapters/04#sources)과 [공개 검증 자료](../../verification/chapter-04/)를 확인하세요.

## 막혔을 때

[Development Lab의 도움말](https://www.studyailab.com/develop/chapters/04#help)을 확인하세요. 실습 Source는 현재 작업을 보존한 뒤 복구의 마지막 수단으로 사용합니다.
