# YouTube Data API

공식 입구: https://developers.google.com/youtube/v3/docs

## 이 책에서 맡는 일
18장 업로드·상태 전환, 19장 읽기, 20장 제한된 답글.

## 준비와 실제 확인
comments.insert의 parentId는 실제 최상위 댓글 ID입니다. 읽기·쓰기 범위를 구분하고 현재 승인 Token을 대조합니다. 비공개 영상은 댓글이 없어 적절한 시험 영상이 필요합니다. thread.replies는 전체가 아닐 수 있습니다.

키·Token은 대화·Git·로그에 넣지 않습니다. 계정·프로젝트·코드의 변수명·입력 환경과 실제 응답을 대조합니다. 현재 가격과 사용 한도는 공식 계정 화면에서 확인합니다. 이 문서의 존재가 실제 연결 검증은 아닙니다.
