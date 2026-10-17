자료 안내와 튜터 연결 절차는 [Development Lab](https://www.studyailab.com/develop)의 튜터 메뉴에서 시작합니다. 받은 파일의 판본을 확인한 뒤 아래 설치 미리보기를 사용합니다. 설치 도구 재실행은 새 자료 다운로드가 아닙니다.

> 이 문서는 Claude가 읽는 안내입니다. 책 준비편의 요청문 하나로 연결되므로 독자가 직접 입력하지 않아도 됩니다. Windows에서 직접 실행할 때는 `python3` 대신 `python`을 쓰고 경로는 `C:\Users\이름\...` 형식으로 씁니다.

> PART 6 개편판 `part6-services-v1`: 19~20장 댓글 자동화 / 21~22장 주식 대화.
> 이 저장소는 장별 명세·요청문·튜터 자료를 제공합니다. 프로젝트 연결과 실제 실행 여부는 아래 절차로 따로 확인합니다.

# 《프로처럼 AI로 코딩 없이 개발하기》 책 전용 AI 개발 튜터

22장에 맞춘 장별 수업 명세, AI용 지도 문서, 단계별 힌트, 검증 기준, 독자 요청문과 로컬 진행 도구입니다. 새 결과물을 만드는 별도 강좌가 아닙니다.

## 먼저 무엇이 들어 있는지 확인합니다

- `chapters/ch01`~`ch22`: 각 장의 `chapter.json`, `tutor.md`, `hints.md`, `verification.md`, `prompts.md`.
- `TUTOR.md`: 공통 행동 규칙. 정상 구현 요청은 실행하고 힌트는 요청한 깊이만 제공합니다.
- `appendices/`: 부록 A~G의 AI용 안내.
- `services/`: 장에서 필요한 공식 입구·준비·권한·비용 확인 규격.
- `glossary/`: 짧은 뜻과 현재 장의 예로 설명하는 규칙.
- `tutor_runtime.py`: 근거 기록·진도 계산·다음 작업·완료 조건 대조.
- `install_tutor.py`: 기존 지침을 보존하는 프로젝트별 연결. 기본은 미리보기입니다.
- `bind_sources.py`: 책에서 사용하는 프로젝트 소스의 실제 위치를 연결합니다. 파일 연결과 실행 검증은 구분합니다.

**이 패키지에는 22개 장의 수업 명세가 있지만 장별 프로젝트 원본이 자동으로 포함되는 것은 아닙니다.** `source-registry.json`에서 제공된 기준 소스와 연결 상태를 확인할 수 있습니다. 연결되지 않은 소스나 실행하지 않은 기능은 완료된 것으로 안내하지 않습니다.

## 받은 자료와 로컬 기록

받은 패키지에서는 `tutor/` 아래의 상대 구조를 유지합니다. 다른 프로젝트에 연결할 때도 이 폴더의 원본을 직접 섞어 쓰기보다 아래 설치 도구로 대상과 변경 내용을 먼저 확인합니다.

실제 키·Token·독자 진행 기록·`source-registry.local.json`은 올리지 않습니다. 이 자료를 받는 것 자체가 그 안의 프로그램이나 원본 소스의 Hook·Skill 실행을 승인한 것은 아닙니다.

## 설치 — 독자 또는 실습 AI가 실행할 명령

[튜터 연결하기](SETUP.md). Code와 Chat의 구분, 자동 승인이 막을 때의 수동 승인 방법, 회사 인증 화면이 뜰 때의 대응을 이 안내에서 먼저 확인합니다. 튜터는 현재 프로젝트에만 연결하며 기존 설정과 학습 진도를 보존합니다.

Python이 있는 환경에서 아래를 사용합니다. 다른 위치의 Python을 가정하지 말고 현재 설치를 먼저 확인합니다. 독자는 이 명령 옵션을 외우는 것이 아니라 책의 설치 요청으로 안내받습니다.

```sh
python3 install_tutor.py --project "/실제/실습/프로젝트" --tool claude
```

변경할 파일과 대상이 맞는지 확인한 후 적용합니다.

```sh
python3 install_tutor.py --project "/실제/실습/프로젝트" --tool claude --apply
```

Codex만 사용하는 경우 `--tool codex`, 두 도구를 실제로 사용하는 경우에만 `--tool both`를 선택합니다.

Claude 연결은 프로젝트의 `CLAUDE.local.md`와 `.claude/skills/book-tutor/SKILL.md`, Codex 연결은 `AGENTS.md`와 `.agents/skills/book-tutor/SKILL.md`를 사용합니다. 도구마다 실제 지침 검색·Skill 발견 방식은 현재 버전에서 확인해야 합니다. 이 파일들이 설치됐다고 실제 도구가 읽었다고 보고하지 않습니다. 기존 사용자 규칙은 보존합니다. 사용자 홈·회사 설정·Git 초기화·API 승인·패키지 설치는 수행하지 않습니다.

새 대화에서 튜터 규칙과 현재 장 파일의 경로를 확인하고 첫 힌트에서 실습 파일이 바뀌지 않는지 봅니다. 새 프로젝트로 옮기면 해당 프로젝트에 연결합니다. 이 설치는 기기의 전역 보안 정책을 바꾸지 않습니다.

## 사용 — 네 문장

**이번 장 시작해 / 현재 진도 알려줘 / 힌트 줘 / 장 완료 확인해줘**

실습 중 다음 입력이 필요하면 **“다음 요청문 보여줘”**라고 요청합니다. 튜터가 현재 단계의 책 요청문 한 개와 입력 위치를 보여줍니다. 내용을 확인한 뒤 **“진행해”**라고 말하면 해당 작업을 수행하고 결과를 확인합니다. “실행해”도 같은 뜻으로 알아듣습니다. 기존 표현인 “다음 명령문 보여줘”도 계속 사용할 수 있습니다. 다른 서비스 대화창에 넣을 질문이나 직접 해야 할 설정은 그 위치로 안내합니다.

이미 확인한 장과 진도를 매번 다시 묻지 않습니다. 정본이나 현재 단계를 확인할 수 없으면 추측하지 않고 필요한 정보만 확인합니다. 실패한 작업은 결과를 확인한 뒤 재시도할 수 있습니다.

자연어는 Claude 또는 Codex가 공통 규칙으로 해석합니다. 아래 Python 도구 자체가 언어모델이거나 모든 자연어를 분류하는 서버는 아닙니다. AI는 해당 장의 JSON·MD를 읽고 필요한 도구만 사용합니다.

```sh
python3 tutor_runtime.py start --chapter 11 --project "/실제/ai-stock-briefing"
python3 tutor_runtime.py progress --chapter 11 --project "/실제/ai-stock-briefing"
python3 tutor_runtime.py next --chapter 11 --project "/실제/ai-stock-briefing"
python3 tutor_runtime.py hint --chapter 11 --topic H11-01 --level 1
python3 tutor_runtime.py verify --chapter 11 --project "/실제/ai-stock-briefing"
```

start/progress/next/hint/verify는 실습 코드·설정을 수정하거나 네트워크·셸 명령을 실행하지 않습니다. verify는 등록된 관찰과 현재 파일의 일치를 대조합니다. 실제 Test 실행이나 계정 조회가 필요하면 AI가 목적·대상·영향을 확인하고 허용된 도구로 수행한 뒤 실제 근거만 등록합니다. 등록되지 않은 것을 확인된 것처럼 세지 않습니다.

## 다음 요청문 조회 — 실습 AI용

현재 장의 `prompt-guide.json`은 요청문의 단계·조건·입력 위치를 연결합니다. 요청문 본문은 복제하지 않고 원문 파일의 블록과 해시로 확인합니다. 실습 AI는 현재 대화와 실제 진도를 대조해 ID를 선택합니다. 목록의 다음 항목이 언제나 다음 실습은 아닙니다.

```sh
python3 tutor_runtime.py prompt-list --chapter 11 --project "/실제/ai-stock-briefing"
python3 tutor_runtime.py prompt --chapter 11 --project "/실제/ai-stock-briefing" --id P11-04
```

두 조회는 원문을 검증해서 반환하며 프로젝트를 수정하거나 요청문을 실행하지 않습니다. `prompt`의 `markdown`은 원문을 보존한 복사용 코드 블록입니다. 실제 수행은 독자의 “진행해”를 받은 개발 AI가 맡습니다. 입력창 자동 채움이나 별도 실행 서버는 없습니다.

## 실제 근거 등록

예시는 설치를 검사했다는 실제 관찰 파일을 등록하는 형태입니다. 예시 파일을 만들어 성공한 척하지 않습니다. 종류·관찰자·대상·실제 결과가 해당 목표의 명세와 맞아야 합니다.

```sh
python3 tutor_runtime.py record --chapter 1 --project "/실제/movie-report" --objective ch01-g01 --kind file-inspection --outcome pass --artifact docs/check-project.md --environment local --observer assistant
```

내용과 실제 관찰을 대조한 뒤 `--apply`를 추가하면 로컬 `.book-tutor-state/`에 저장합니다. 증거 내용은 복사하지 않고 파일 위치와 해시를 기록합니다. 실제 비밀값이 들어 있는 파일은 증거로 선택하지 않습니다. `human-observation`은 사람이 확인해 준 결과라는 출처를 유지하며, AI가 직접 봤다고 바꾸지 않습니다.

이 기록 엔진은 **허위 보고의 진실성을 독립적으로 인증하는 장치가 아닙니다.** 실제로 수행하지 않은 관찰을 등록하면 안 됩니다. 시험 응답·사람 확인·실계정 결과는 같은 것으로 바꾸지 않습니다. 코드나 증거가 변경되면 재확인 상태가 되고, 키 값·외부 정책처럼 로컬 해시가 보지 못하는 변경도 재확인이 필요합니다.

## 원본 소스 연결

```sh
python3 bind_sources.py --source-root "/실제/공식실습저장소"
python3 bind_sources.py --source-root "/실제/공식실습저장소" --apply
```

실제 `chapters/chNN/source/`가 있는 경우만 로컬 결합 파일에 기록합니다. 연결 파일은 `source-registry.local.json`이며 공개하지 않습니다. START는 기본적으로 앞 장 완료 상태를 가리키되 새 프로젝트 장은 빈 시작 조건을 따릅니다. 소스 파일을 발견했다고 그 장을 재현한 것은 아닙니다. 저장소에 기록된 기준 커밋·URL·파일 해시도 실제 실행 확인을 대신하지 않습니다.

## 갱신·제거

갱신은 새 지원 패키지를 별도로 받은 뒤 정본과 호환 판본을 확인하고 설치 미리보기를 다시 실행합니다. 기존 Skill을 사용자가 수정했다면 자동 덮어쓰지 않습니다. 이 패키지에는 원격에서 항상 최신을 추적하는 서비스가 없습니다.

제거할 때는 프로젝트의 튜터 Skill과 연결 파일 안 `BOOK-TUTOR-MANAGED` 블록만 확인해 삭제합니다. `AGENTS.md`의 다른 사용자 규칙·실습 코드·진도·참고 소스는 함께 지우지 않습니다. 진행 기록과 자료를 삭제할지는 사용자가 따로 결정합니다.

## 검사

```sh
python3 tutor_runtime.py audit-contracts
python3 -m unittest discover -s tests -v
```

포함된 테스트는 임시 합성 프로젝트에서 실행하는 로컬 프로그램 검사입니다. 실제 Claude/Codex 대화에서의 동작, API 호출, YouTube 게시는 이 테스트에 들어 있지 않습니다. 튜터가 연결됐는지는 새 대화를 열어 확인합니다.
