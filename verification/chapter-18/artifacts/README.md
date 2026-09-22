# 18장 검증에 사용한 파일

저자가 18장을 확인한 결과와 측정 조건입니다. 실습에 필요한 파일은 아니고, 저자가 어떻게
확인했는지 보여주기 위한 자료입니다.

| 파일 | 무엇인가 |
|---|---|
| [check-result.json](check-result.json) | 실제 업로드 결과와 요청한 권한, 자동 검사 결과 |

18장 요청문은 [chapters/ch18/prompts.md](../../../chapters/ch18/prompts.md)에 있고, PART 5를
끝낸 완성 상태는
[chapters/ch18/source/ai-shorts-maker/](../../../chapters/ch18/source/ai-shorts-maker/)에
있습니다.

## 돌려보기

검사는 실제 구현 저장소
[ai-shorts-maker](https://github.com/buildyourownai-lab/ai-shorts-maker)에서 함께
공개합니다. 그 프로젝트 폴더를 Claude Code에서 열고 아래처럼 말하면 됩니다.

```text
이 프로젝트의 Test 전체를 실행해서 결과를 알려줘.
```

YouTube 인증 파일과 Token, 업로드 결과 Receipt는 여러분의 환경에서 직접 만드는 값이라
여기에 넣지 않았습니다. 자동 검사는 실제로 업로드하지 않고 돌아갑니다.
