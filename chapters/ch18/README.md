# 18장. 만든 영상을 실제 YouTube에 올립니다

## 이 장에서 만드는 것

17장에서 `UPLOAD READY`가 된 영상을 실제 YouTube 채널에 올립니다. 앞의 두 장은 내 컴퓨터
안에서 파일을 만들고 검사했지만, 이번에는 프로그램이 외부 서비스의 상태를 바꿉니다.
그래서 올리기 전에 무엇이 바뀌는지 먼저 확인합니다.

```text
업로드 대상을 고정한다
→ 제목·설명·공개 범위를 Preview로 본다
→ Google OAuth로 권한을 받는다
→ 비공개로 올린다
→ YouTube Studio에서 확인한다
```

16장에서 만든 같은 프로젝트에서 이어서 진행합니다. 이 장에서는 Reviewer와 별도로
Publisher 역할을 만듭니다. Reviewer는 합격 여부를 판단하고, Publisher는 그 결과를 실제
계정에 반영합니다. 기본값은 비공개 업로드입니다. 공개를 선택하면 비공개로 올린 뒤 같은 영상 ID의 공개 범위만 바꾸며, 상태 변경에 필요한 OAuth 권한을 별도로 확인합니다. 실행 전에 시험 응답으로 두 단계와 실패·재시도를 검증합니다.

## 프롬프트

[prompts.md](prompts.md)에 18장에서 입력하는 문장이 책의 순서대로 있습니다. 모두 Claude
Code에 입력합니다.

## 장별 Source

[source/ai-shorts-maker/](source/ai-shorts-maker/)에 PART 5(16~18장) 전체를 끝낸 완성
상태가 있습니다. 실제
[ai-shorts-maker](https://github.com/buildyourownai-lab/ai-shorts-maker) 저장소에는 책을
마친 뒤 만든 실험용 영상 스크립트가 더 있지만, 이 Source에는 18장 완료에 필요한 파일만
있습니다. 정상 흐름에서 먼저 열어보는 정답지가 아니라, 아래 복구
방법으로도 해결하지 못했을 때 쓰는 마지막 수단입니다.

## 검증 결과

[Development Lab의 검증 요약](https://www.studyailab.com/develop/chapters/18#sources)과 [공개 검증 자료](../../verification/chapter-18/)를 확인하세요.

## 막혔을 때

[Development Lab의 도움말](https://www.studyailab.com/develop/chapters/18#help)을 확인하세요. 실습 Source는 현재 작업을 보존한 뒤 복구의 마지막 수단으로 사용합니다.
