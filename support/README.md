# Study AI Lab MCP의 로컬 학습 지원

[Study AI Lab MCP 연결](https://www.studyailab.com/develop/mcp#connect) 후 개발 AI에게 장 시작·요청문·힌트·진도·완료 확인을 자연어로 요청하세요. **별도 튜터나 두 번째 MCP 설치는 필요하지 않습니다.** 이 폴더는 같은 학습 흐름에서 내 컴퓨터의 파일과 관측 기록을 확인하는 보조 도구입니다. 명령 옵션은 AI가 처리하므로 독자가 외울 필요가 없습니다.

공식 [지원 파일 안내](https://www.studyailab.com/develop/mcp#support-files)에서 판본이 고정된 파일과 현재 제공 상태를 확인합니다. 지원 파일을 받았다는 사실만으로 그 안의 코드 실행이 승인되거나 프로젝트가 완료되지는 않습니다. 파일을 받는 과정과 압축 해제·원본 확인은 별도로 검사합니다.

## 무엇을 어디서 하나

- 원격 MCP: 공개 학습 자료와 고정 판본을 조회합니다. 로컬 경로·프로젝트 상태·증거·키를 보내지 않습니다.
- 개발 AI: 기존 사용자·조직 규칙과 승인 범위에 따라 현재 파일을 확인하고 실제 실습을 진행합니다.
- 이 지원 도구: manifest와 파일 해시를 검증하고, 실제 관측을 바탕으로 로컬 진도를 대조합니다. 네트워크·셸 실행·설치·제품 파일 수정은 하지 않습니다.

Python 3.10 이상과 표준 라이브러리만 사용합니다. Python이 아직 없으면 개발 AI와 1장의 환경 준비를 먼저 진행한 뒤 지원 도구의 doctor 검사를 이어갑니다. Python 부재를 MCP 연결 실패로 판단해 다시 등록하지 않습니다.

## AI가 사용하는 명령

아래는 실행 인자의 형식을 보여주는 예시입니다. `<manifest.json>`과 `<reader-folder>`는 실제 확인한 경로로 바꿔야 하며 그대로 실행하는 명령이 아닙니다.

```text
python3 support/studyailab.py doctor --bundle <manifest.json> --book develop --edition development-2026 --project <reader-folder>
python3 support/studyailab.py prompt --bundle <manifest.json> --book develop --edition development-2026 --chapter 01 --prompt-id P01-02
```

명령은 doctor, verify-bundle, inspect, prompt, hint, progress, record입니다. 책·판본·고정 manifest를 명시합니다. 조회는 상태를 만들거나 요청문을 실행하지 않습니다. 힌트4단계는 `--explicit-solution`으로 해답을 명시 요청해야 합니다.

record는 프로젝트 안의 비밀값을 제거한 관측 JSON을 읽고 기본적으로 미리보기만 합니다. 독자가 저장을 요청한 경우 `--apply`로 `.studyailab`에 추가합니다. 기존 관측을 덮어쓰지 않으며 복사·이동된 프로젝트의 위치 결합이 맞지 않으면 거부합니다. 실제 이동을 요청한 경우에만 `record --rebind`로 새 위치 결합을 미리 보고 `--apply`로 저장합니다. 이전 결합은 이력에 남으며 예전 실행 승인을 새 대화나 프로젝트로 옮기지 않습니다.

## 근거와 진도의 한계

관측 기록은 **명령이 실행됐거나 API가 성공했다는 독립 인증이 아닙니다.** 관측자·실패·차단·변경·만료 상태를 보존합니다. 비어 있지 않은 `inspected_inputs` 목록으로 실제 확인한 파일만 결합하며, 목록 밖 파일·키·서비스 계정·전체 앱을 검증했다고 주장하지 않습니다. simulation 관측은 실제 목표 완료로 세지 않습니다.

기록 전 키와 제공자의 원시 오류를 제거합니다. 파일 해시·UTC 관측 시각·계약 판본을 명시하고, test-run에는 비밀값을 제거한 stdout/stderr 파일·argv·시작/종료 시각·exit code·timeout 여부도 필요합니다. 역사적 실패 관측은 변경되는 제품 파일 대신 별도 `evidence/` snapshot으로 남깁니다. 파일 변경·관측 만료·판본 변경 뒤에는 다시 확인합니다.

## 확인한 범위

오프라인 테스트, 실제 MCP 응답의 UTF8/base64 조립·해시 대사와 Codex CLI의 연결·첫 행동 안내를 확인했습니다. 이는 Claude Desktop Code 탭·Windows 실제 동작, 장별 전체 실습, 외부 계정/API의 성공을 뜻하지 않습니다. 책의 여러 프로젝트는 직접 만들고 누적하며, 공개 완성 Source는 비교·복구에만 사용합니다. 비공개 저자 저장소는 필요하지 않습니다.

개발·검토용 오프라인 검사는 다음과 같습니다. 임시 fixture의 통과를 실제 독자 환경의 완료로 기록하지 않습니다.

```text
python3 -m unittest discover -s support/tests -v
```
