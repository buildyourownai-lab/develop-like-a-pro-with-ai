# 15장. 같은 서비스를 iPhone 앱으로 만듭니다 — 완료 검증 규격

검증은 사용자 요청 범위의 확인입니다. 실제 게시·삭제·결제는 별도 명확한 행동 승인 없이 실행하지 않습니다. 증거를 확보하지 않은 것을 PASS로 입력하지 않습니다.

|목표|확인 기준|근거 종류|기대 결과|
|---|---|---|---|
|ch15-g01|지원 OS·Xcode·용량·약관 확인|human-observation|pass|
|ch15-g02|기기 환경을 준비하고 실행|test-run|pass|
|ch15-g03|기존 서버와 계획된 iPhone 화면 연결|file-inspection|pass|
|ch15-g04|시장→검색→종목→공시→브리핑 실제 사용|human-observation|pass|
|ch15-g05|Secret·기기 권한·오류·화면 확인|human-observation|pass|
|ch15-g06|Simulator 확인 범위와 미실행 환경 구분|human-observation|pass|

## 다시 확인할 때
코드·실행 환경·대상·인증 설정이 바뀌었으면 관련 근거를 다시 확인합니다. 파일 해시로 감지하지 못하는 외부 정책·권한·키 변화는 사람이 알려야 합니다. 기존 기록을 덮어쓰지 않고 새 기록을 추가합니다.
