# 21~22장 튜터 호환성 확인 (기획–구현 개편판)

기준 시점: 2026-09-14 · 대상: `tutor/` 튜터 자료와 21~22장 장 계약

21장을 기획, 22장을 전체 구현으로 나눈 새 학습 계약을 유지한 상태에서, 기존 튜터 실행 모듈이
그대로 동작하는지 확인한 기록입니다. 학습 내용이 아니라 **호환성만** 다룹니다.

## 확인한 사실

아래 명령을 이 저장소에서 실행해 결과를 직접 확인했습니다.

| 명령 | 결과 |
|---|---|
| `python3 -m unittest discover -s tutor/tests -q` | 79건 전부 통과 (개편 전에는 실행 오류 23건·실패 1건) |
| `python3 tutor/tutor_runtime.py audit-contracts` | 22개 장 계약·목표 138개 `PASS` |
| `python3 tutor/bind_sources.py --source-root <빈 폴더>` | 연결된 Source 0개, 21~22장 `not_bound` |
| `python3 tutor/tutor_runtime.py start --chapter 21 --project <빈 폴더>` | 21장 기획 목표 문장이 그대로 표시되고 진행도 0 |
| `python3 tutor/tutor_runtime.py next --chapter 22 --project <빈 폴더>` | 22장 첫 목표 `ch22-plan-build-v2-g01` 안내, 상태 `unconfirmed` |

## 고친 것과 판단 근거

1. **예전 이름을 별칭으로 추가** — 21~22장 계약의 새 이름(`will_complete_this_chapter`,
   `carry_forward_state`, `carry_forward_features`)을 그대로 두고, 실행 모듈이 아직 쓰는 예전
   이름(`outcome`, `start_state`, `previously_completed_features`)을 **같은 값**으로 함께
   적었습니다. 어떤 이름이 어떤 이름을 가리키는지는 `legacy_field_aliases`에 적어 두었습니다.
   실행 모듈의 이름 규칙을 21~22장만을 위해 바꾸지 않기 위한 선택이며, 새로운 완료 근거를
   만들어내지 않습니다.
2. **판본 값의 뜻을 분리** — `source-registry.json`의 `required_revision`은 Source 묶음 표식
   형식(`part6-services-v1`)이고, 장 계약·모듈 판본은 새 항목 `contract_revision`
   (`plan-build-v2`)으로 따로 적었습니다. 두 값을 한 칸에 섞어 쓰면 정상적인 Source 표식이
   판본 불일치로 거부됩니다. 뜻의 구분은 `revision_semantics`에 적어 두었습니다.
3. **프로젝트 폴더 경로 기준 통일** — 임시 폴더처럼 상위 경로가 링크로 연결된 위치를
   프로젝트로 지정하면, 프로젝트 안의 파일을 프로젝트 밖으로 잘못 판정하는 문제가 있었습니다.
   경로 비교 시 프로젝트 폴더도 같은 방식으로 확정하도록 한 줄만 고쳤습니다. 21~22장과
   무관한 예전 문제지만 확인 실행 자체를 막고 있었습니다.

## 추가한 회귀 확인 (7건)

- 21·22장 계약의 예전 이름과 새 이름이 같은 값을 가리키는지, 별칭 표가 맞는지
- 21·22장 `start` 화면이 현재 계약 문장을 그대로 보여주고 진행도가 0인지
- 21·22장 계약이 실행 확인·Source 연결을 주장하지 않는지(`unverified`, `unbound`)
- `contract_revision`과 `required_revision`이 서로 다른 뜻으로 유지되는지
- 표식이 없는 21·22장 Source 폴더는 계속 미연결인지
- `contract_revision`이 정상적인 Source 표식의 연결을 막지 않는지(연결되어도 실행 확인은 거짓)
- 링크로 연결된 프로젝트 폴더에서도 프로젝트 안 파일을 읽는지

기대 결과를 통과 쪽으로 바꾼 확인은 없습니다. 1~20장의 학습 동작과 문서는 손대지 않았습니다.

## 아직 확인하지 않은 것

- **개편한 21~22장 실습을 새 AI로 처음부터 다시 따라가 본 재현은 하지 않았습니다.** 위 결과는
  튜터 계약·실행 모듈의 호환성 확인이며, 실제 챗봇 구현 결과를 확인한 것이 아닙니다.
- 21~22장 Source는 계속 **미연결(`not_bound`)**입니다. 예전 판본 Source를 새 실습의 결과로
  대신 쓰지 않습니다.
- `tutor/CONTENT-MANIFEST.json`의 파일 해시 15건은 개편 내용과 아직 다릅니다. 해시 갱신은
  공개 준비 단계의 별도 작업으로 남겨 두었습니다.
