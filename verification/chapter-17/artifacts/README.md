# 17장 검증에 사용한 파일

저자가 17장을 확인한 결과입니다. 실습에 필요한 파일은 아니고, 저자가 어떻게 확인했는지
보여주기 위한 자료입니다. 두 파일은 검사기가 그대로 출력한 결과입니다.

| 파일 | 무엇인가 |
|---|---|
| [review-normal.json](review-normal.json) | 정상 영상의 검사 결과 -- 13항목 통과, UPLOAD READY |
| [review-damaged.json](review-damaged.json) | 일부러 망가뜨린 사본의 검사 결과 -- 5항목 실패, NOT READY |

17장 요청문은 [chapters/ch17/prompts.md](../../../chapters/ch17/prompts.md)에 있고, 검사
기준과 검사 Skill은
[chapters/ch18/source/ai-shorts-maker/](../../../chapters/ch18/source/ai-shorts-maker/)에
있습니다.

## 돌려보기

검사 기준과 검사 Skill은 실제 구현 저장소
[ai-shorts-maker](https://github.com/buildyourownai-lab/ai-shorts-maker)에서 함께
공개합니다. 그 프로젝트 폴더를 Claude Code에서 열고 자신의 영상을 검사하려면 아래처럼
말하면 됩니다.

```text
내가 만든 영상을 video-upload-review Skill의 기준으로 업로드 전 검사해줘.
```

검사에 사용한 영상 파일은 용량이 커서 저장소에 넣지 않았습니다.
