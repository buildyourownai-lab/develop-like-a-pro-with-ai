# 19장. AI가 내 유튜브 댓글을 읽고 답글을 준비합니다 — 완료 확인 규격

앱 실행을 확인한 기록이 아닙니다. 아래 조건으로 Claude가 구현과 실행을 검증하고 실제 증거를 남깁니다.

## ch19-r2-g01 · 프로젝트 구분

영상 프로젝트·주식서비스를 보존하고 댓글 도구의 실제 폴더와 실행 주소를 확인합니다.

필수: True / 증거: file-inspection / 환경: local-or-manual / 기대 결과: pass / 선행: 없음

## ch19-r2-g02 · 영상·권한 준비

내 채널의 영상과 댓글 사용 가능 여부, 실제 Token의 조회 범위를 확인합니다.

필수: True / 증거: live-api / 환경: actual-account-or-service / 기대 결과: pass / 선행: ch19-r2-g01

## ch19-r2-g03 · 읽기 경계

승인한 영상의 최상위 댓글만 읽고 오류·0건·부분 조회를 구분하며 쓰기를 호출하지 않습니다.

필수: True / 증거: test-run / 환경: local-or-manual / 기대 결과: pass / 선행: ch19-r2-g02

## ch19-r2-g04 · 분류와 초안 검사

다섯 종류와 세 처리 수준, 혼합·악성 지시·개인정보·검사 실패의 사람 전환을 시험합니다.

필수: True / 증거: test-run / 환경: local-or-manual / 기대 결과: pass / 선행: ch19-r2-g03

## ch19-r2-g05 · 실제 자료 확인

실제 댓글을 읽은 결과와 Gemini 분류·초안을 로컬 미리보기에서 확인합니다.

필수: True / 증거: live-ui / 환경: actual-account-or-service / 기대 결과: pass / 선행: ch19-r2-g04

## ch19-r2-g06 · 전송 없음 확인

프로그램에 전송 경로가 없고, 실습 전후 실제 YouTube에 도구의 답글이 추가되지 않았는지 확인합니다.

필수: True / 증거: external-confirmation / 환경: actual-account-or-service / 기대 결과: pass / 선행: ch19-r2-g05

코드·설정·명세·근거가 달라지면 재확인합니다. 실제 쓰기·과금·공개는 완료 확인 문장만으로 시작하지 않습니다.
