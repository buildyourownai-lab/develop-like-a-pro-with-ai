# 15장. 같은 서비스를 iPhone 앱으로 만듭니다

## 이 장에서 만드는 것

14장까지 만든 ai-stock-briefing을 iPhone 앱으로 확장합니다. 주식 데이터와 공시, AI 브리핑을
새로 만들지 않고 Android 앱이 쓰는 서버를 그대로 씁니다. 앱 파일을 만들었다는 것으로 끝내지
않고, 공식 iPhone Simulator에 설치해 직접 사용하는 것까지가 이 장의 결과물입니다.

이 장은 Mac에서 진행합니다.

이 장에서 확인하는 것은 여섯 가지입니다.

| 무엇 | 어떻게 확인하나 |
|---|---|
| 공식 iPhone 환경에서 앱이 실행된다 | Simulator에 설치한 앱의 첫 화면이 실제 서버 자료로 채워지는지 확인합니다 |
| Android에서 확인한 흐름이 iPhone에서도 이어진다 | 시장에서 종목을 찾아 차트와 공시, AI 브리핑까지 내려가는지 확인합니다 |
| 공식 원문으로 내려가는 길이 남아 있다 | 공시 한 건에서 dart.fss.or.kr 원문이 Safari로 열리는지 확인합니다 |
| AI 품질 기준이 iPhone에서도 유지된다 | 브리핑의 근거와 출처, 알 수 없는 것이 웹과 같은 항목으로 나오는지 확인합니다 |
| 연습용 연결과 실제 서비스 연결이 나뉘어 있다 | Release 앱이 Production HTTPS 주소에서 실제 자료를 받는지 확인합니다 |
| 앱에 Secret과 불필요한 권한이 없다 | 완성된 앱에서 외부 서비스 Secret이 발견되지 않고 필요하지 않은 기기 권한을 요청하지 않는지 확인합니다 |

앱의 화면 배치와 내부 구조는 매번 달라집니다. 완료 기준은 책과 같은 코드가 나오는 것이
아니라 위 여섯 가지를 실제 Simulator에서 확인하는 것입니다.

## 프롬프트

[prompts.md](prompts.md)에 15장에서 Claude Code에 입력하는 문장이 책의 순서대로 있습니다.

## 장별 Source

[source/ai-stock-briefing/](source/ai-stock-briefing/)에 15장을 끝낸 상태가 있습니다.
9장부터 15장까지 만든 파일이 모두 들어 있어 이 폴더만 받아도 자기 컴퓨터에서 돌릴 수
있습니다. 14장 상태와 비교하면 iPhone 앱 프로젝트가 더해졌습니다. 서버와 Android 앱은
그대로입니다.

정상 흐름에서 먼저 열어보는 정답지가 아닙니다. 아래 복구 방법으로도 이어갈 수 없을 때
16장부터 계속 진행하기 위한 마지막 수단입니다.

## 검증 결과

[Development Lab의 검증 요약](https://www.studyailab.com/develop/chapters/15#sources)과 [공개 검증 자료](../../verification/chapter-15/)를 확인하세요.

## 막혔을 때

[Development Lab의 도움말](https://www.studyailab.com/develop/chapters/15#help)을 확인하세요. 실습 Source는 현재 작업을 보존한 뒤 복구의 마지막 수단으로 사용합니다.
