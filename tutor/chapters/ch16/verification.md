# 16장. AI와 YouTube 영상을 만듭니다 — 완료 검증 규격

검증은 사용자 요청 범위의 확인입니다. 실제 게시·삭제·결제는 별도 명확한 행동 승인 없이 실행하지 않습니다. 증거를 확보하지 않은 것을 PASS로 입력하지 않습니다.

|목표|확인 기준|근거 종류|기대 결과|
|---|---|---|---|
|ch16-g01|주제 근거와 시나리오를 확인|human-observation|pass|
|ch16-g02|장면 구성·기준 이미지·후보를 검토|human-observation|pass|
|ch16-g03|사용 조건·생성 비용·다운로드 파일 확인|human-observation|pass|
|ch16-g04|음성·자막·소리를 조합해 최종 MP4 생성|test-run|pass|
|ch16-g05|처음부터 끝까지 영상·음성·자막 확인|human-observation|pass|
|ch16-g06|제작 기록과 youtube-shorts-production 저장|file-inspection|pass|

## 다시 확인할 때
코드·실행 환경·대상·인증 설정이 바뀌었으면 관련 근거를 다시 확인합니다. 파일 해시로 감지하지 못하는 외부 정책·권한·키 변화는 사람이 알려야 합니다. 기존 기록을 덮어쓰지 않고 새 기록을 추가합니다.
