# 21장 START 경로 연결 호환성 확인 (튜터 Source 연결기)

기준 시점: 2026-09-14 · 대상: `tutor/bind_sources.py`, `tutor/source-registry.json`,
`tutor/tests/test_part6_binding.py`

21장이 기획 전용 장으로 바뀌면서 START가 **앞 장의 FINISH가 아니라 21장 자신의 START 묶음**이
되었습니다. 이 문서는 튜터의 Source 연결기가 그 구조를 받아들이도록 고친 내용과, 직접 실행해
확인한 결과만 적습니다. 실습 내용이나 Source 자체의 정확성은 다루지 않습니다.

## 고친 것과 판단 근거

1. **21장 START를 등록표에서 선언하도록 바꿨습니다.** 이전 연결기는 `prev=12 if n==21 else n-1`로
   21장 START를 12장 폴더에 **코드에서 고정**하고 있었습니다. 이제 `source-registry.json`의 21장
   항목에 `start_path: "chapters/ch21/start"`를 적고, 연결기는 그 값을 읽습니다. 값이 없는 장은
   앞 장 FINISH를 START로 보는 기존 규칙을 그대로 씁니다(22장 START = `chapters/ch21/source`).
   장 번호를 코드에 더 넣지 않기 위한 선택입니다.
2. **선언된 경로는 검사한 뒤에만 씁니다.** `declared_start()`가 (1) 빈 값·문자열이 아닌 값,
   (2) 절대 경로, (3) `..`가 들어간 경로, (4) 링크 등으로 `--source-root` 밖을 가리키게 되는
   경로를 모두 거부하고, (5) 폴더가 실제로 없으면 미연결로 둡니다. 거부 이유는 그 장 항목의
   `start_binding_note`에만 적고, `binding_note`(FINISH 표식 판정)는 덮어쓰지 않습니다.
3. **선언된 START도 자기 표식으로 증명해야 연결합니다(이번에 추가).** 경로 검사를 지나도
   그것만으로는 연결하지 않습니다. `marker_note()`가 FINISH와 같은 검사를 START에도 적용합니다.
   START 표식은 그 폴더 옆의 `<폴더이름>-revision.json`(21장은 `chapters/ch21/start-revision.json`)
   이며, 다음을 모두 통과해야 `start_local_path`가 채워집니다.
   - 스냅샷이 비어 있지 않음(`.env*`·`.git`·`node_modules` 등 제외 후 파일이 남아야 함)
   - 표식 파일이 있고 JSON으로 읽히며 객체임
   - `revision`이 등록표의 `required_revision`(Sourcepack 형식 `part6-services-v1`)과 같음
   - `project`가 등록표의 `project`와 같음
   - `snapshot_role`이 `START`임(FINISH 표식을 돌려 쓰지 못하게 함)
   - `contract_revision`이 등록표의 `contract_revision`(`plan-build-v2`)과 같음
   - `files`가 실제 폴더를 다시 해시한 결과와 **정확히** 같음(파일 추가·삭제·수정 모두 불일치)
   하나라도 어긋나면 START는 `null`로 두고 어긋난 항목을 짚은 이유를 `start_binding_note`에
   적습니다. 12장·20장 폴더 등 다른 경로로 조용히 대체하는 길은 없습니다.
   `snapshot_role`·`contract_revision` 검사는 START에만 겁니다. FINISH 쪽 검사는 기존 그대로
   유지하고(약화하지 않고) 깨진 JSON을 예외 대신 거부 이유로 남기는 것만 좋아졌습니다.
4. **START 판정은 FINISH 판정과 독립입니다.** 선언된 START는 그 장 FINISH가 연결되지 않아도
   자기 표식만으로 판정합니다. 반대로 START가 통과해도 FINISH 표식이 없으면 FINISH는 계속
   미연결입니다. `start_path`가 없는 장의 기본 규칙(앞 장 FINISH)은 앞 장이 자기 표식 검사를
   통과했을 때만 START로 씁니다. 그래서 19·20장은 START도 비어 있습니다.
5. **뜻이 섞이지 않게 등록표에 설명을 남겼습니다.** `start_path_semantics`에 이 값이 경로 선언일
   뿐이며 Source 연결이나 실행 확인을 뜻하지 않는다고 적었습니다. `required_revision`
   (Sourcepack 형식 `part6-services-v1`)과 `contract_revision`(장 계약 판본 `plan-build-v2`)의
   구분은 이전 확인에서 정한 대로 그대로 두었습니다.

12장 항목과 `chapters/ch12/source`는 건드리지 않았습니다. 공개된 12장 Source는 그대로입니다.

## 확인한 사실

아래를 이 작업 폴더에서 직접 실행해 결과를 확인했습니다.

| 명령 | 결과 |
|---|---|
| `python3 -m unittest discover -s tutor/tests -q` | 93건 전부 통과 |
| `python3 tutor/tutor_runtime.py audit-contracts` | 22개 장 계약·목표 138개 `PASS` |
| `python3 tutor/bind_sources.py --source-root <빈 폴더>` | 연결 0개, 12·21·22장 `not_bound`, START 전부 없음, 21장은 `start_binding_note: "Declared START folder is missing."` |
| `python3 tutor/bind_sources.py --source-root .` (`--apply` 없음) | 아래 "실제 폴더 확인" 표 |
| 실제 폴더에서 등록표만 바꿔 21장 `project`·`required_revision`·`contract_revision`을 어긋나게 한 재실행 | 세 경우 모두 21장 START `null`, 어긋난 항목을 짚은 `start_binding_note` |

### 실제 폴더 확인 (읽기 전용, `--apply` 없음)

| 장 | FINISH | START | 파일 수 | 이유 |
|---|---|---|---|---|
| 21 | `chapters/ch21/source` 연결(`files_present_not_executed`) | `chapters/ch21/start` 연결 | FINISH 124 | START·FINISH 표식 검사 통과 |
| 22 | 미연결(`not_bound`) | `chapters/ch21/source` | – | `chapters/ch22/source`에 새 Sourcepack 표식이 없는 예전 원격 운영판이어서 거부 |
| 19·20 | 미연결 | 없음 | – | 같은 이유(표식 없음). 앞 장이 통과하지 않으면 START로도 쓰지 않음 |
| 1~18 | 연결 | 앞 장 FINISH | – | `required_revision`이 없는 기존 장, 규칙 그대로 |

연결된 장은 19개이고 `execution_verified`는 모든 장에서 `false`입니다. `--apply`를 쓰지 않았으므로
`tutor/source-registry.local.json`은 만들어지지 않았습니다(실행 후 없음을 확인).

표식과 실제 폴더의 파일 수가 다른 것은 정상입니다. `chapters/ch21/start`의 실제 파일은 124개,
표식 `start-revision.json`의 `files`는 123개인데, 차이는 `ai-stock-briefing/.env.example` 한 개뿐이며
연결기의 `snapshot()`이 `.env`로 시작하는 파일을 제외하기 때문에 해시 비교가 정확히 일치합니다.
FINISH도 같습니다(실제 125개, 표식 124개, 차이는 같은 `.env.example` 한 개). 두 표식의 `files` 어디에도
`.env.example`은 들어 있지 않으며, 표식의 `note`도 전체 파일 목록에만 그 파일이 포함된다고 적고
있습니다. **이전 보고에 있던 "표식에 `.env.example`이 들어 있어 해시가 어긋난다"는 서술은
사실이 아니므로 철회합니다.** 실제 두 파일을 다시 읽어 확인했습니다.

## 회귀 확인 (전체 93건, 이번에 8건 추가)

경로 검사 관련(이전 확인에서 추가, 그대로 통과):

- 21장 START가 선언한 START 묶음이며, 12장·20장 폴더가 함께 있어도 그쪽을 가리키지 않는지
- 12장 항목이 21장 변경에 영향받지 않는지(FINISH는 자기 폴더, START는 11장 폴더, `start_path` 없음)
- 선언한 START 폴더가 없으면 연결하지 않고 이유를 남기는지
- 안전하지 않은 `start_path`(`..`, 절대 경로, 빈 값, 문자열이 아닌 값 등 11가지)를 모두 거부하는지
- `chapters/ch21/start`가 `--source-root` 밖을 가리키는 링크일 때 거부하는지
- 기존 기본 규칙이 유지되는지(11장 START = 10장 FINISH, 22장 START = 21장 FINISH)
- 프로젝트의 첫 장(9장 등)은 여전히 START가 없는지

이번에 추가한 표식 검사(각 항목마다 정상적인 START 폴더는 그대로 두어, 거부가 "폴더 없음"
때문이 아님을 확인했고, 12장·20장 폴더가 함께 있어도 그쪽으로 대체되지 않음을 함께 확인):

1. 표식 파일이 없을 때 거부하고 이유에 `start-revision.json`을 적는지
2. 표식이 깨진 JSON일 때 거부하는지(예외로 죽지 않고 이유를 남김)
3. 표식이 JSON 객체가 아닐 때(`[]`) 거부하는지
4. START 폴더가 비었거나 `.env`만 있을 때 거부하는지
5. 표식은 그대로 두고 START 파일 하나를 고쳤을 때(위조) 해시 불일치로 거부하는지
6. `project`, `revision`(Sourcepack 형식), `contract_revision`, `snapshot_role`(FINISH 표식 돌려쓰기),
   `files`에 없는 파일 추가, `files` 키 누락 — 6가지 어긋남을 각각 거부하고 항목을 짚는지
7. 표식까지 통과한 START는 그 장 FINISH가 없어도 연결되고, 그때도 FINISH는 미연결이며
   `execution_verified`는 `false`인지
8. START가 통과해도 표식 없는 FINISH는 연결되지 않는지(FINISH 검사 약화 없음)

기대 결과를 통과 쪽으로 바꾼 확인은 없습니다. 기존 `start21()` 도우미는 이제 정상적인 START
표식까지 만들어 줍니다. 이는 검사를 느슨하게 한 것이 아니라, 새 규칙에서 "정상"의 정의가
바뀌어 정상 fixture를 맞춘 것입니다.

## 아직 확인하지 않은 것

- **실습 재현(프롬프트 재생)은 하지 않았습니다.** 21장 START/FINISH 연결은 "선언된 파일 묶음이
  표식과 정확히 같다"는 사실까지입니다. 그 파일로 21장 실습을 다시 돌려 같은 결과가 나오는지는
  확인하지 않았고, `execution_verified`는 모든 경로에서 `false`로 남습니다.
- 22장 Source는 계속 **미연결**입니다. 새 Sourcepack 표식이 붙은 22장 묶음이 놓이기 전까지는
  거부가 맞는 동작입니다.
- **`--apply`로 등록표를 확정하지 않았습니다.** 위 결과는 읽기 전용 모의 실행입니다.
- `tutor/CONTENT-MANIFEST.json`의 파일 해시는 갱신하지 않았습니다(공개 준비 단계 작업).
- 이 작업에서 Source 파일과 표식 파일, 제품 코드는 고치지 않았습니다.
