# 16장. AI와 YouTube 영상을 만듭니다

## 이 장에서 만드는 것

주제 한 줄에서 시작해 60초에 조금 못 미치는 YouTube Shorts 한 편을 완성합니다. 영상
편집 프로그램을 배우지 않고, 무엇을 이야기할지와 어떤 소재·음악을 쓸지만 정합니다.
실제 MP4를 만드는 일은 Claude가 맡습니다.

```text
주제를 정한다
→ 사실을 확인하고 Storyboard를 받는다
→ 영상 소재와 음악을 고른다
→ Claude가 MP4를 만든다
→ 처음부터 끝까지 재생해서 확인한다
```

PART 5는 ai-shorts-maker라는 새 프로젝트에서 시작합니다. 이 장을 끝내면 1080×1920 세로
화면에 한국어 목소리와 음악, 한글 자막이 들어간 MP4 한 편과, 다음 영상에서 다시 쓰는
제작 절차 Skill이 생깁니다. 두 번째 영상부터는 이번과 달라질 점만 말하면 됩니다.

## 프롬프트

[prompts.md](prompts.md)에 16장에서 입력하는 문장이 책의 순서대로 있습니다. 모두 Claude
Code에 입력합니다.

## 장별 Source

16장을 끝낸 상태는 [source/ai-shorts-maker/](source/ai-shorts-maker/)에 있습니다. 정상
흐름에서 먼저 열어보는 정답지가 아니라, 아래 복구 방법으로도 해결하지 못했을 때 쓰는
마지막 수단입니다. 이 Source로 다시 시작하면 16장의 남은 실습을 건너뛰고 17장부터
이어가게 됩니다. PART 5(16~18장)를 모두 끝낸 완성 상태는
[ch18/source/ai-shorts-maker/](../ch18/source/ai-shorts-maker/)에 있습니다.

## 검증 결과

[Development Lab의 검증 요약](https://www.studyailab.com/develop/chapters/16#sources)과 [공개 검증 자료](../../verification/chapter-16/)를 확인하세요.

## 막혔을 때

[Development Lab의 도움말](https://www.studyailab.com/develop/chapters/16#help)을 확인하세요. 실습 Source는 현재 작업을 보존한 뒤 복구의 마지막 수단으로 사용합니다.
