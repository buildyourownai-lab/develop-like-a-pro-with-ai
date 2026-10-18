# 5장. 잘되던 때로 돌아갈 곳을 만들어둡니다

## 이 장을 시작할 때

[Study AI Lab MCP 연결](https://www.studyailab.com/develop/mcp#connect) 후 개발 AI에게 **“5장 시작해”**라고 요청하세요. 별도 튜터 설치는 필요하지 않습니다. AI가 현재 장·판본·작업 폴더를 확인하고 다음 행동 하나를 안내합니다. 앞 장에서 만든 `movie-report`와 실제 확인 결과를 이어갑니다. 장이 바뀔 때마다 완성 Source를 새로 복사해 시작하지 않습니다.

요청문·힌트 조회는 실행이나 완료 확인과 다릅니다. 실제 작업과 진도는 내 컴퓨터에서 확인하며, 필요한 [로컬 지원 파일](https://www.studyailab.com/develop/mcp#support-files)의 명령 옵션은 AI가 처리합니다. 아래 기존 검증 기록은 새 MCP 경로의 장별 전체 재현 완료를 뜻하지 않습니다.

## 이 장에서 만드는 것

방금 한 변경을 빠르게 되돌리는 방법과, 오래 남길 정상 상태를 기록하고 컴퓨터
밖에도 보관하는 방법을 만듭니다. movie-report 프로젝트의 마지막 장입니다.

| 방법 | 무엇을 되돌리는가 |
|---|---|
| Checkpointing | Claude Code 안에서 방금 한 변경만 빠르게 |
| Git | 확인한 정상 상태를 기록하고, 필요한 파일만 선택해서 |
| GitHub | 컴퓨터 밖에도 프로젝트와 기록을 보관 |
| Plan mode | 영향이 큰 변경을 실행하기 전에 먼저 계획만 확인 |

끝나면 공통 ~/.claude/CLAUDE.md에 "주요 작업이 끝나면 정상 상태를 기록한다"와 "새
프로젝트는 기록할 곳부터 확인한다"는 원칙이 추가되어, 다음부터는 매번 요청하지 않아도
Claude가 그 순서를 따릅니다.

## 프롬프트

[prompts.md](prompts.md)에 5장에서 Claude Code에 입력하는 문장이 책의 순서대로
있습니다.

## 장별 Source

[source/movie-report/](source/movie-report/)에 PART 1(1~5장) 전체를 끝낸 완성
상태가 있습니다. movie-report 프로젝트의 마지막 장이므로, 완성된 프로젝트 자체는
[movie-report](https://github.com/buildyourownai-lab/movie-report) 저장소에서도
볼 수 있습니다.

## 검증 결과

[Development Lab의 검증 요약](https://www.studyailab.com/develop/chapters/05#sources)과 [공개 검증 자료](../../verification/chapter-05/)를 확인하세요.

## 막혔을 때

[Development Lab의 도움말](https://www.studyailab.com/develop/chapters/05#help)을 확인하세요. 실습 Source는 현재 작업을 보존한 뒤 복구의 마지막 수단으로 사용합니다.
