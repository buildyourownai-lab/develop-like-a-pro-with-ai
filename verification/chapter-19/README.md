# 19장 검증

댓글 도구의 현행 장별 Source를 검사했습니다. 자동 검사는 외부 API 모형을 포함하며 실제 계정 검증과 구분합니다.

- 제품 커밋: `d35dc320965e26a020abef9c00737b506832fc98`
- Source SHA-256: `e8bad605807fb42d7a39640202f3d9ac9594605412bf555ad802f93bdbfbc7f2`
- 공개 복사본 검사: 27개 파일, 332개 테스트 통과. lint·typecheck·build 통과, 동일 잠금 파일 의존성 audit 취약점 0건.
- [검사 요약](checks.json) · [테스트](test.txt) · [린트](lint.txt) · [타입](typecheck.txt) · [빌드](build.txt)
- START에서 요청문을 순서대로 실행하는 독자 재현과 실물 인쇄는 미검증입니다.

실제 YouTube 계정의 채널·영상 설정·댓글 2개 조회와 Gemini 분류·초안을 확인했습니다. 촬영한 실행에서 후보 1개가 두 검사를 통과했고 다른 1개는 답하지 않음으로 분류됐습니다. AI 응답은 실행마다 달라질 수 있습니다. 댓글 전송은 0건입니다.

실제 화면 5개는 디지털 촬영 검수를 통과했습니다. Studio 설정은 서로 다른 위치·시점의 화면이며, 앱 전체와 초안 카드는 같은 실행입니다. 인쇄 크기의 작은 설정 글자 가독성은 추가 검수가 필요합니다.

- [screen-19-01-audience.png](../../assets/chapter-19/screen-19-01-audience.png)
- [screen-19-01-channel.png](../../assets/chapter-19/screen-19-01-channel.png)
- [screen-19-01-video-settings.png](../../assets/chapter-19/screen-19-01-video-settings.png)
- [screen-19-02-context.png](../../assets/chapter-19/screen-19-02-context.png)
- [screen-19-02-preview.png](../../assets/chapter-19/screen-19-02-preview.png)
