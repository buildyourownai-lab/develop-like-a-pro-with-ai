# 부록 G. 내가 만든 것을 AI 포트폴리오로 바꿉니다

## 이 부록으로 하는 일

이미 만든 여섯 결과물 가운데 하나를 골라, 다른 사람이 열었을 때 무엇을 만든 것인지
바로 읽히게 정리합니다. 새로 만드는 것은 없습니다. 보이게 하는 것이 전부입니다.

보는 사람이 알고 싶은 것은 네 가지입니다. 어떤 문제를 해결하려 했나, AI와 어떻게
만들었나, 자신은 어떤 판단을 했나, 결과를 어떻게 확인하고 개선했나. 아래 골격의 절
제목이 그 네 가지입니다.

## 프롬프트

[prompts.md](prompts.md)에 이 부록에서 Claude Code에 입력하는 문장이 책의 순서대로
있습니다.

## 순서대로 합니다

**1. 대표 프로젝트 하나를 고릅니다.** 내 분야나 지원하려는 자리의 반복 업무와 가장 가까운
하나를 고릅니다. 나머지는 「같은 방법으로 만든 것」에 한 줄씩만 연결합니다. 내 소재로
다시 만드는 일은 필수가 아니며, 원하면 [prompts.md](prompts.md)의 첫 요청문으로 시작합니다.

**2. README를 완성합니다.** [templates/project-readme.md](templates/project-readme.md)를
고른 저장소의 `README.md`에 붙이고 〈 〉를 채웁니다. 결과 화면과 실제로 열리는 주소를
준비·실행보다 먼저 둡니다. [templates/prompts.md](templates/prompts.md)에는 처음 시킨 것,
원인을 찾게 시킨 것, 검사를 만들게 시킨 것 세 개만 옮깁니다. 당시 원문을 찾지 못해 다시
적었다면 「나중에 재구성한 요약」이라고 표시합니다.

**3. 검증 기록을 만들고 공개 전 검사를 합니다.**
[templates/verification.md](templates/verification.md)를 `docs/verification.md`로 가져가
실제로 돌린 검사와 결과만 적습니다. 이어 [prompts.md](prompts.md)의 공개 전 요청문으로
현재 파일뿐 아니라 지난 Commit의 API Key·환경변수·개인정보·사용 조건도 검사합니다.
한 번이라도 노출된 Key는 파일에서 지우는 것으로 끝내지 않고 폐기한 뒤 새로 발급받습니다.

**4. 저장소를 공개하고 목록에서 보이게 합니다.** 공개 전 검사를 통과한 뒤에만 GitHub
저장소의 공개 상태를 바꿉니다. About의 Description·Website와 Topics를 채우고 대표 저장소
하나를 Pin합니다. 프로필 README와 Social preview는 선택 단계이며
[guides/github-profile.md](guides/github-profile.md)에 모았습니다.

## 가져다 쓰는 것

| 파일 | 어디로 |
|---|---|
| [templates/project-readme.md](templates/project-readme.md) | 고른 저장소의 README.md |
| [templates/prompts.md](templates/prompts.md) | 고른 저장소의 docs/prompts.md |
| [templates/verification.md](templates/verification.md) | 고른 저장소의 docs/verification.md |

세 파일 모두 〈 〉만 채우면 됩니다. 채우지 못한 자리는 지어내지 않고 비워둡니다.

## 함께 보는 곳

- 저자가 같은 것을 어떻게 남겼는지는 [verification/](../../verification/)에서 볼 수
  있습니다.
- 발급받은 Key를 폐기하고 새로 받는 순서는 [appendix-d/](../appendix-d/)에 있습니다.
- Markdown 표기가 낯설면 [Markdown 여덟 형식](guides/markdown.md)을 봅니다.
- 대표 프로젝트를 GitHub 목록과 프로필에 보이게 하는 선택 절차는
  [GitHub 프로필 가이드](guides/github-profile.md)에 있습니다.
