---
name: video-upload-review
description: YouTube Shorts MP4를 업로드하기 전에 기술 검사와 AI 시각 검사를 같은 기준으로 실행하고 UPLOAD READY 여부를 판정한다. 영상을 만들거나 업로드하는 작업에는 사용하지 않는다.
argument-hint: <video-path>
---

# Video Upload Review

대상 영상: `$ARGUMENTS`

이 Skill은 업로드 전 품질 Gate다. 통과는 `READY / UPLOAD READY`, 실패나 판단 불가는 `HOLD / NOT READY`로 다룬다. `UPLOAD READY`는 검사 통과 상태일 뿐 공개 또는 업로드 허가가 아니다.

1. `ai-shorts-maker` 정본의 `prototypes/youtube-shorts/chapter-17/review-policy.json`을 읽고 대상에 적용할 기준을 확인한다.
2. 같은 정본의 `scripts/review_video.py`를 AI 시각 검토 파일 없이 먼저 실행해 기술 검사 결과와 Contact Sheet를 만든다. 이 첫 실행은 시각 검토가 없으므로 `NOT READY`가 정상이다.
3. Contact Sheet를 직접 보고 자막 존재·가독성, 심한 피사체 잘림, 눈에 띄는 화면 손상을 각각 판단한다. 보이지 않거나 확신할 수 없는 항목을 통과로 추정하지 않는다.
4. 판단을 다음 구조의 JSON으로 저장한다.

```json
{
  "reviewer": "AI Reviewer",
  "video": "검토한 영상 경로",
  "judgments": {
    "subtitles_present_and_readable": true,
    "subjects_not_severely_cropped": true,
    "no_obvious_visual_corruption": true
  },
  "notes": ["실제 관찰만 기록"]
}
```

5. 같은 검사기를 `--visual-review`와 함께 다시 실행한다. 모든 자동 검사와 AI 시각 판단이 PASS일 때만 `UPLOAD READY`를 보고한다.
6. 실패하면 실패 항목과 관찰 근거를 보고하고 `NOT READY`를 유지한다. 검사기가 영상을 자동 수정하거나 업로드하게 하지 않는다.

사람은 최종 영상을 소리와 함께 재생하고, 내용·권리·공개 여부를 결정한다. 다음 장의 업로드 행동은 별도 승인이 필요하다.
