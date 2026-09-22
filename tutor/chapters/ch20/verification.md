# 20장. 허용한 댓글에만 자동으로 답하게 합니다 — 완료 확인 규격

앱 실행을 확인한 기록이 아닙니다. 아래 조건으로 Claude가 구현과 실행을 검증하고 실제 증거를 남깁니다.

## ch20-r2-g01 · 권한·배포 경계

실제 youtube.force-ssl 승인과 채널, 서버 전용 비밀값, Production의 로컬 화면 차단을 확인합니다.

필수: True / 증거: live-api / 환경: actual-account-or-service / 기대 결과: pass / 선행: 없음

## ch20-r2-g02 · 후보 범위

기준 시각·최근 7일·한 영상·최상위 댓글·페이지 재개·자기 댓글 제외를 시험합니다.

필수: True / 증거: test-run / 환경: local-or-manual / 기대 결과: pass / 선행: ch20-r2-g01

## ch20-r2-g03 · 중복·미확인

동시 선점·여러 댓글 순차 전송·전송 후 응답 단절·저장 실패 때 재전송하지 않는지 격리 시험합니다.

필수: True / 증거: test-run / 환경: local-or-manual / 기대 결과: pass / 선행: ch20-r2-g02

## ch20-r2-g04 · 한 건의 전송

승인한 같은 시험 댓글의 실제 답글과 기록 ID를 대조하고 재실행에서 추가 전송이 없는지 봅니다.

필수: True / 증거: external-confirmation / 환경: actual-account-or-service / 기대 결과: pass / 선행: ch20-r2-g03

## ch20-r2-g05 · 실제 예약

사전 승인한 자동 범위에서 예약이 실제 호출하고 처리한 기록을 확인합니다. 등록만으로 완료하지 않습니다.

필수: True / 증거: external-confirmation / 환경: actual-account-or-service / 기대 결과: pass / 선행: ch20-r2-g04

## ch20-r2-g06 · 중지·보존

자동 전송과 예약을 끈 뒤 실제 상태를 확인하고 시작 시각·기록이 남는지 확인합니다.

필수: True / 증거: external-confirmation / 환경: actual-account-or-service / 기대 결과: pass / 선행: ch20-r2-g05

코드·설정·명세·근거가 달라지면 재확인합니다. 실제 쓰기·과금·공개는 완료 확인 문장만으로 시작하지 않습니다.
