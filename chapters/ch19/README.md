# 19장. AI가 내 유튜브 댓글을 읽고 답글을 준비합니다

승인한 영상 한 편의 댓글을 읽어 종류·처리 수준·답글 초안을 로컬에서 확인합니다. 실제 전송은 하지 않습니다.

## 시작점

18장의 영상·검수·업로드 기록은 별도 영상 폴더에 보존하고, ai-media-works를 조사하거나 새로 준비합니다. 댓글이 허용된 적절한 시험 영상이 필요합니다.

## 실습 자료

- [책과 같은 요청문](prompts.md)
- [튜터 명세](../../tutor/chapters/ch19/)
- [장 완료 상태의 Source](source/ai-media-works/)
- [파일별 SHA-256](source-revision.json)
- [검증 범위와 결과](../../verification/chapter-19/)

```bash
cd chapters/ch19/source/ai-media-works
npm ci
npm test
```

설정과 브라우저 실행 순서는 [Source README](source/ai-media-works/README.md)를 따릅니다. Source는 재개·비교용이며, 내려받았다는 사실만으로 독자의 장 완료가 되지 않습니다. 인증정보는 포함하지 않습니다.
