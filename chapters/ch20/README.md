# 20장. 허용한 댓글에만 자동으로 답하게 합니다

승인한 영상·종류·시간 범위에서 자동답글을 보내고, 중복·결과 미확인·중지를 실제로 확인합니다.

## 시작점

19장의 로컬 조회·분류·초안·두 검사가 준비돼 있고 댓글 사용이 가능한 내 영상 한 편이 있습니다.

## 실습 자료

- [책과 같은 요청문](prompts.md)
- [튜터 명세](../../tutor/chapters/ch20/)
- [장 완료 상태의 Source](source/ai-media-works/)
- [파일별 SHA-256](source-revision.json)
- [검증 범위와 결과](../../verification/chapter-20/)

```bash
cd chapters/ch20/source/ai-media-works
npm ci
npm test
```

설정과 브라우저 실행 순서는 [Source README](source/ai-media-works/README.md)를 따릅니다. Source는 재개·비교용이며, 내려받았다는 사실만으로 독자의 장 완료가 되지 않습니다. 인증정보는 포함하지 않습니다.
