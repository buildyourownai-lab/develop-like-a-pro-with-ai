# 6장. 아파트 실거래가와 위치 정보를 가져옵니다

## 이 장을 시작할 때

[Study AI Lab MCP 연결](https://www.studyailab.com/develop/mcp#connect) 후 개발 AI에게 **“6장 시작해”**라고 요청하세요. 별도 튜터 설치는 필요하지 않습니다. AI가 현재 장·판본·작업 폴더를 확인하고 다음 행동 하나를 안내합니다. 책 작업 공간에 `apartment-explorer`를 만들고 공식 데이터·API 준비부터 진행합니다. 앞 PART의 `movie-report`는 보존합니다.

요청문·힌트 조회는 실행이나 완료 확인과 다릅니다. 실제 작업과 진도는 내 컴퓨터에서 확인하며, 필요한 [로컬 지원 파일](https://www.studyailab.com/develop/mcp#support-files)의 명령 옵션은 AI가 처리합니다. 아래 기존 검증 기록은 새 MCP 경로의 장별 전체 재현 완료를 뜻하지 않습니다.

## 이 장에서 만드는 것

PART 2에서 만들 아파트 찾기 서비스의 재료를 준비합니다. 공식 기관과 지도 서비스가
공개한 실제 데이터를 내 프로젝트로 가져오는 것이 이 장의 도착점입니다.

| 무엇 | 어디에서 |
|---|---|
| 아파트 매매 실거래가와 거래 해제 정보 | 국토교통부 (공공데이터포털) |
| 아파트 주소와 위치, 주변 지하철역·초등학교 | Kakao Local API |

apartment-explorer라는 새 프로젝트를 시작하고, 마지막에 웹서비스로 공개할 것을
생각해 TypeScript와 Next.js를 사용합니다.

끝내면 두 API에서 실제 데이터를 가져올 수 있고, 두 개의 키는 프로그램 코드와 Git
기록에서 분리되어 있습니다. 저장해둔 응답 예시로 데이터를 제대로 읽는지 확인하는
Test도 함께 남습니다.

아직 아파트를 찾는 기능은 만들지 않습니다. 그 기능은 7장에서 만듭니다.

## 프롬프트

[prompts.md](prompts.md)에 6장에서 Claude Code에 입력하는 문장이 책의 순서대로
있습니다.

두 개의 키는 독자가 직접 발급받습니다. 발급 화면에서 무엇을 눌러야 하는지는 책
6장에서 화면과 함께 설명합니다.

## 장별 Source

[source/apartment-explorer/](source/apartment-explorer/)에 6장을 끝낸 상태가 있습니다.
apartment-explorer는 6장에서 시작하는 새 프로젝트이므로, 5장까지 만든 movie-report와는
다른 폴더입니다.

이 폴더를 그대로 받아 자기 컴퓨터에서 돌릴 수 있습니다. 두 개의 키는 들어 있지 않으므로
.env.example을 보고 자기 키를 입력하면 됩니다. 키 없이도 저장해둔 응답 예시로 Test를
실행해볼 수 있습니다.

완성된 아파트 찾기 서비스는 8장에서 완결됩니다.

## 검증 결과

[Development Lab의 검증 요약](https://www.studyailab.com/develop/chapters/06#sources)과 [공개 검증 자료](../../verification/chapter-06/)를 확인하세요.

## 막혔을 때

[Development Lab의 도움말](https://www.studyailab.com/develop/chapters/06#help)을 확인하세요. 실습 Source는 현재 작업을 보존한 뒤 복구의 마지막 수단으로 사용합니다.
