# 17장. 올리기 전에 AI가 영상을 검사합니다

## 이 장에서 만드는 것

한 번 재생해 본 것만으로는 올려도 되는 영상인지 알 수 없습니다. 이 장에서는 같은 기준을
반복해서 적용하는 AI Reviewer를 만듭니다. 파일의 기술 조건은 자동으로 확인하고, 숫자로
판단하기 어려운 화면은 대표 장면을 뽑아 AI가 확인합니다.

```text
검사 기준을 정한다
→ 정상 영상을 검사한다 → PASS → UPLOAD READY
→ 일부러 망가뜨린 사본을 같은 기준으로 검사한다 → FAIL → NOT READY
```

16장에서 만든 같은 프로젝트에서 이어서 진행합니다. 이 장을 끝내면 제작 Skill과 분리된
검사 Skill, 그리고 검사 기준을 담은 설정 파일이 생깁니다. `UPLOAD READY`는 공개해도 된다는
허가가 아니라 정해둔 품질 검사를 모두 통과했다는 뜻입니다. 하나라도 실패하면 영상을
자동으로 고치지 않고 멈춥니다.

## 프롬프트

[prompts.md](prompts.md)에 17장에서 입력하는 문장이 책의 순서대로 있습니다. 모두 Claude
Code에 입력합니다.

## 장별 Source

17장을 끝낸 상태는 [source/ai-shorts-maker/](source/ai-shorts-maker/)에 있습니다. 이 장에서
새로 생기는 파일만 담고 있으므로 [ch16/source/ai-shorts-maker/](../ch16/source/ai-shorts-maker/)와
합쳐서 씁니다. 정상 흐름에서 먼저 열어보는 정답지가 아니라, 아래 복구 방법으로도 해결하지
못했을 때 쓰는 마지막 수단입니다. 이 Source로 다시 시작하면 17장의 남은 실습을 건너뛰고
18장부터 이어가게 됩니다. PART 5(16~18장)를 모두 끝낸 완성 상태는
[ch18/source/ai-shorts-maker/](../ch18/source/ai-shorts-maker/)에 있습니다.

## 검증 결과

[Development Lab의 검증 요약](https://www.studyailab.com/develop/chapters/17#sources)과 [공개 검증 자료](../../verification/chapter-17/)를 확인하세요.

## 막혔을 때

[Development Lab의 도움말](https://www.studyailab.com/develop/chapters/17#help)을 확인하세요. 실습 Source는 현재 작업을 보존한 뒤 복구의 마지막 수단으로 사용합니다.
