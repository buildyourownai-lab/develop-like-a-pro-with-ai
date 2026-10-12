# AI Shorts 제작 명령

## 대본 검수와 제작

음성을 만들기 전에 현재 장면 구성표와 내레이션을 기준으로 검수 기록을 만듭니다.

```bash
python3 scripts/make_roman_concrete_short.py review
```

생성된 `script-review.json`에서 다음 다섯 항목과 출처·검수자를 확인한 뒤
`status`를 `PASS`로 승인합니다.

- 맞춤법·띄어쓰기·누락
- 숫자·단위·용어
- 내레이션·자막 일치
- 사실
- 출처

승인 후에는 음성만 먼저 만듭니다.

```bash
python3 scripts/make_roman_concrete_short.py voice
```

생성된 일곱 장면의 음성을 직접 듣고 발음·속도·길이를 확인합니다. 문제가 있으면
대본을 고친 뒤 `review`부터 다시 실행합니다. 이상이 없으면 최종 영상을 조립합니다.

```bash
python3 scripts/make_roman_concrete_short.py all
```

대본이 한 글자라도 바뀌면 기존 승인은 무효이며, 검수를 다시 통과하기 전에는
음성 API 호출과 기존 음성 재사용이 차단됩니다.

## 18장 업로드(비공개 우선, 공개는 별도 상태 변경)

업로드는 항상 비공개 Insert가 먼저이고, 공개(또는 일부공개) 요청은 같은 영상의
상태만 별도 Token/Scope로 바꾸는 두 번째 호출입니다.

```bash
python3 scripts/upload_private_video.py --plan <plan.json> --execute                 # 비공개 업로드
python3 scripts/upload_private_video.py --plan <plan.json> --execute --privacy public # 비공개 업로드 후 공개로 전환
```

상태 변경이 실패하면 비공개 업로드 성공·공개 미완료로 나눠 기록합니다. 같은
명령을 다시 실행하면 Receipt의 video ID로 상태 변경만 재시도하며 다시 Insert하지
않습니다. 상태 변경 호출은 `status.privacyStatus`와 함께 `status.selfDeclaredMadeForKids`도
항상 같이 보냅니다. `videos.update`는 지정한 `part`의 모든 mutable 속성을 요청 값으로
덮어쓰므로, 이 필드를 빼면 16장에서 확정한 아동용 설정이 삭제될 수 있기 때문입니다.

### 즉시 실행과 나중에 별도로 요청하는 공개 전환의 차이

위 두 명령을 한 번의 `--execute`로 이어서 실행하는 것(비공개 Insert → 그 자리에서
바로 공개로 상태 변경)과, 이미 `status_state=complete`로 끝난 비공개 Receipt에
**나중에 별도로** `--privacy public`(또는 `unlisted`)을 명시해 실행하는 것은 서로
다른 경로이지만 둘 다 지원합니다.

```bash
# 지금 막 비공개로 끝난 영상을 나중에(다른 날, 다른 실행에서) 공개로 바꾼다.
python3 scripts/upload_private_video.py --plan <plan.json> --execute --privacy public
```

이 나중 경로가 안전하게 동작하는 조건은 다음과 같습니다.

- `--privacy`를 **이번 실행에서 명시적으로** 넘겼을 때만 이미 끝난 Receipt를 다시
  연다. Plan의 기본 `privacy` 값만으로는 절대 열리지 않는다 — CLI에 아무 것도 안
  넘기면 두 번째 실행은 항상 기존 동작대로 ALREADY UPLOADED(exit 3, Insert/Update
  0건)로 남는다.
- 명시한 값이 Receipt가 확인한 실제 공개 상태(`actual_privacy`, Legacy Receipt는
  `privacy`)와 같으면 여전히 ALREADY UPLOADED(exit 3)이며 API를 호출하지 않는다.
- 명시한 값이 다르면, `videos.update`를 부르기 전에 Receipt의 `video_sha256`·
  `channel_handle_expected`·`title`·(있다면) `made_for_kids`가 Plan과 정확히
  일치하는지 다시 확인한다. 하나라도 다르면 Receipt를 건드리지 않고 BLOCKED(exit 6)로
  남는다.
- 확인되면 Receipt의 `requested_privacy`/`status_state`를 새 목표로 원자적으로 먼저
  바꿔 쓴 뒤에만 기존 상태 변경 경로(`apply_status_change`, 같은 video ID의
  `videos.update`)를 부른다. 이 경로는 **Insert를 절대 호출하지 않는다.**
  상태 변경이 실패하면 방금 쓴 `public-incomplete` Receipt가 그대로 남아, 다음의
  평소 재시도가 여전히 같은 video ID로 상태 변경만 다시 시도한다(Insert 0건).
- `status_state=public-incomplete`인 Receipt(직전 요청이 아직 실제로 적용되지
  않은 상태)에 **다시 다른** `--privacy`를 명시하면, 같은 정체성 확인을 거쳐
  목표만 새로 바꾸고 계속 같은 video ID로 상태 변경을 시도한다. 확인에 실패하면
  기존 목표를 그대로 둔 채 BLOCKED로 남는다.
- 두 단계 발행 이전에 쓰인 Legacy Receipt(`privacy` 필드 하나로 실제 상태를
  나타내던 방식)는 그 값이 `private`일 때만 이 나중 경로의 안전한 시작점으로
  취급한다. 정체성 확인을 통과하면 현재 스키마(`status_state`/`requested_privacy`/
  `actual_privacy`)로 변환한 뒤 같은 상태 변경 경로를 그대로 탄다. `private`가
  아닌 값을 가진 Legacy Receipt, 또는 정체성이 Plan과 안전하게 맞아떨어지지 않는
  Legacy Receipt는 여전히 ALREADY UPLOADED/BLOCKED로 남고 절대 추측해서 변환하지
  않는다.

`videos.insert`를 부르기 전에 먼저 "Insert 대기 중"(`insert-pending`) Receipt를
기록합니다. 이 상태에서 그대로 죽거나(Kill) 끊기면 Receipt는 `insert-pending`으로
남습니다. Insert 호출이 예외를 던지거나 응답에 video ID가 없으면, 서버가 실제로
영상을 만들었는지 클라이언트는 알 수 없으므로 "Insert 결과 불명"(`insert-ambiguous`)
상태로 남깁니다. 두 상태 모두 같은 명령을 다시 실행해도 자동으로 재업로드하지
않고 BLOCKED로 남습니다.

## Insert 시도가 미해결(`insert-pending`/`insert-ambiguous`) 상태의 재구성(Reconcile)

Receipt JSON을 손으로 고치거나 지우지 않습니다. 대신 아래 두 명령만 사용하며,
`insert-pending`과 `insert-ambiguous` 두 상태 모두에 동작합니다. 둘 다 Insert를
0건 수행합니다.

```bash
# 영상이 있는 경우: Studio에서 확인한 실제 video ID를 넘긴다.
python3 scripts/upload_private_video.py --plan <plan.json> --execute \
  --reconcile-video-found <VIDEO_ID>

# 영상이 없는 경우: Studio를 확인했다는 명시적 확인과 함께 넘긴다.
python3 scripts/upload_private_video.py --plan <plan.json> --execute \
  --reconcile-not-found --confirm-studio-checked
```

`--reconcile-video-found`는 넘겨받은 ID를 `videos.list`로 읽기 전용 조회해 다음을 모두
확인합니다(Insert/Update는 호출하지 않고, 검증에 성공하면 Receipt만 known-ID 상태로
바꿉니다). 하나라도 다르면 BLOCKED로 남고 Insert/Update는 0건입니다.

- Receipt의 `channel_handle_expected`를 `channels.list(forHandle=...)`로 조회한 채널
  ID(기대 채널 ID)와, 현재 인증된 계정의 `channels.list(mine=true)` 채널 ID가 같은지.
  `mine=true`만으로는 "지금 로그인한 계정 소유"만 증명할 뿐 "그 계정이 기대한
  Brand 계정과 같다"는 것을 증명하지 못하므로, 두 조회를 각각 수행해 비교합니다.
- 후보 영상의 `snippet.channelId`가 그 기대 채널 ID와 같은지.
- 정확한 제목.
- `publishedAt`이 Insert 시도 시각(`started_at`)을 기준으로 앞뒤 24시간(고정 오차)
  이내인지. `now()` 기준이 아니라 항상 `started_at` 기준이므로, Reconcile 자체가
  한참 뒤에 실행돼도 그 사이에 올라온 다른 동명 영상은 통과하지 못합니다.
- 후보 영상의 `status.privacyStatus`가 허용된 값 중 하나이고 `status.selfDeclaredMadeForKids`가
  Receipt가 의도한 값과 일치하는지. 둘 다 확인되지 않으면(응답에 없거나, 형식이
  다르거나, 값이 다르면) 추측하지 않고 BLOCKED로 남습니다.

검증에 성공하면 Receipt를 known-ID 상태로 바꾸고, 요청한 공개 범위가 이미 실제
상태면 완료로, 아니면 `public-incomplete`로 남겨 다음 정상 실행이 상태 변경만
재시도하게 합니다. Receipt 자체가 malformed(예: 필수 필드 누락)이면 인덱싱 전에
검사해 Traceback 없이 BLOCKED로 남습니다.

**`--reconcile-not-found`는 확인되지 않은 결과를 재업로드 허가로 쓰지 않습니다.**
Insert를 절대 하지 않고, 기존 Receipt를 Audit 기록으로 `archive/`에 남긴 뒤 원래
Receipt 파일은 지우지 않고 그 자리에서 `tombstone` 상태로 덮어씁니다. 이 영상
해시는 이후 이 도구의 어떤 평소 실행으로도 다시 Insert되지 않습니다 — 자동으로는
영구히 막힌 채로 남습니다. 진짜로 새 업로드가 필요한 드문 경우에는, 아래
`--authorize-new-attempt`로 사람이 별도로 승인해야만 다음 평소 `--execute`가 딱
한 번 Insert를 수행합니다. YouTube가 새 영상을 늦게 보여줄 수 있으므로 이 확인은
스냅샷일 뿐이며, 나중에 실제로 영상이 나타나면 Studio에서 직접 처리합니다 — 여기서
아무것도 손으로 지우지 않습니다.

Receipt 파일이 손상된 JSON이면 이제 Traceback 없이 BLOCKED로 남고 Insert/Update를
0건 수행합니다. Receipt는 항상 같은 디렉터리의 임시 파일에 먼저 쓰고
flush/fsync·chmod 600·`os.replace`로 원자적으로 교체하므로, 쓰다가 중단돼도
일부만 쓰인 파일이 남지 않습니다. Archive 파일명은 같은 초에 두 번 Archive해도
기존 Audit 기록을 덮어쓰지 않도록 충돌 안전하게 고릅니다.

## Tombstone 이후 정말로 새 업로드가 필요할 때(`--authorize-new-attempt`)

이 절차는 아주 드물게, Studio를 직접 확인한 사람만 사용합니다. `--reconcile-not-found`가
남긴 Tombstone은 기본적으로 영구적입니다 — 자동 재시도로는 절대 풀리지 않습니다.
그럼에도 정말로 새로 업로드해야 한다는 것을 사람이 별도로 확인했다면, 두 단계로
나눠 안전하게 처리합니다.

**1단계 — 승인만 한다(Insert/Update 0건).**

```bash
python3 scripts/upload_private_video.py --plan <plan.json> --execute \
  --authorize-new-attempt <ATTEMPT_ID> --confirm-duplicate-risk
```

- `<ATTEMPT_ID>`는 대문자 영숫자 3~32자, 그 뒤에 `-`로 구분된 대문자 영숫자
  1~32자 구간을 최대 4개까지 붙일 수 있는 보수적인 형식만 허용합니다(예:
  `REATTEMPT-20260914-01`). 소문자·공백·그 외 문장부호·긴 자유 형식 문장은
  모두 거부되므로, 이 필드에 Secret이나 설명문을 넣을 수 없습니다.
- 이 명령 자체는 YouTube API를 전혀 호출하지 않습니다. Receipt가 정확히
  `tombstone` 상태이고 Plan과 정체성(해시·채널·제목·아동용 설정)이 일치하는지만
  확인한 뒤, 기존 Tombstone을 Audit 기록으로 `archive/`에 남기고 그 자리를
  `authorized-new-attempt` 상태로 원자적으로 덮어씁니다. 이 새 Receipt는 이전
  Tombstone 시각·이전 Archive 경로·새 Attempt ID/승인 시각을 모두 그대로 담습니다.
- 같은 `ATTEMPT_ID`는 이 영상 해시의 Archive 기록 전체(과거의 모든 승인/소비
  포함)에서 단 한 번만 쓸 수 있습니다. 재사용하면 Insert 0건으로 BLOCKED입니다.
- `--confirm-duplicate-risk` 없이, 잘못된 형식의 ID로, `tombstone`이 아닌
  상태(예: `insert-pending`/`complete`)에, 또는 Plan과 Receipt의 정체성이
  맞지 않는 상태에서 실행하면 모두 Insert 0건으로 BLOCKED입니다.
- 이 명령은 그 자체로 아무것도 업로드하지 않습니다. 이 승인을 소비하는 것은
  전혀 다른, 나중의 2단계뿐입니다.

**2단계 — 나중에, 별도로, 평소와 똑같은 `--execute`로 소비한다(딱 1회 Insert).**

```bash
python3 scripts/upload_private_video.py --plan <plan.json> --execute
```

- 이 명령에는 `--authorize-new-attempt`도 다른 어떤 특별한 Flag도 붙지 않습니다
  — 평소 업로드와 완전히 같은 명령입니다. Receipt가 `authorized-new-attempt`
  상태임을 발견하면, Plan과 정체성이 다시 일치하는지 확인한 뒤에만 그 승인을
  소비합니다. 확인에 실패하면 Insert 0건으로 BLOCKED이고 승인은 그대로 남습니다
  (다시 시도할 수 있습니다).
- 소비는 원자적입니다: 먼저 그 승인 Receipt를 Audit 기록으로 Archive한 뒤,
  평소 첫 업로드와 똑같은 `insert-pending` Receipt를 써서 Insert를 시작합니다.
  이 전환이 끝나는 순간부터 이 승인은 다시 쓸 수 없습니다 — 재실행하면
  `insert-pending`/`insert-ambiguous` 상태의 평소 Reconcile 절차(위 섹션)만
  적용되며, 승인을 다시 소비하거나 두 번째 Insert를 수행하지 않습니다.
- Insert 도중 예외가 나거나 죽어도(Crash) 평소와 똑같이 `insert-ambiguous`로
  남고, 위의 `--reconcile-video-found`/`--reconcile-not-found`로만 재구성합니다.
  이 재-Tombstone 경로도 이미 사용한 `ATTEMPT_ID`를 Archive에 영구히 남기므로,
  같은 ID로 다시 승인을 시도할 수 없습니다.
- 승인 없이 평소처럼 Tombstone된 Receipt에 그냥 `--execute`만 실행하면 여전히
  Insert 0건으로 BLOCKED입니다 — 이 2단계 절차를 건너뛸 방법은 없습니다.

## PART 6 인계(Handoff)는 완료되고 확인된 공개/일부공개 Receipt에서만 동작

PART 6로 넘길 정보(video URL, video ID, 기대하는 채널 정체성)만 출력합니다. MP4
경로·Token·Secret·Receipt 내용은 절대 출력하지 않습니다.

```bash
python3 scripts/upload_private_video.py --plan <plan.json> --handoff
```

`--handoff`는 `status_state`가 `complete`인 Receipt(또는 그와 동등한, 두 단계
발행 이전의 Legacy Receipt)이면서, 실제로 확인된 공개 범위(`actual_privacy`,
Legacy Receipt는 `privacy`)가 `public` 또는 `unlisted`일 때만 성공(exit 0)합니다.
19장은 시청자가 실제로 영상을 보고 댓글을 남길 수 있어야 하므로, 완료됐지만
`private`로 남아 있는 Receipt는 성공으로 취급하지 않습니다 — 세 필드짜리
Whitelist는 출력하지 않고, 이 같은 video ID에 나중에 별도로
`--privacy public`(또는 `unlisted`)을 명시해 먼저 공개로 전환해야 한다고
안내한 뒤 BLOCKED(exit 6)로 남습니다. `public-incomplete`·`insert-pending`·
`insert-ambiguous`·`tombstone`·`authorized-new-attempt` 상태도 완료된 발행
인계가 아니므로 같은 이유로 BLOCKED(exit 6, 출력 없음)입니다. 아직 확정되지
않은 video ID가 진단에 필요하면 이 명령이 아니라 `--reconcile-*` 명령이나 Receipt
자체를 사람이 직접 확인합니다.

이 privacy 확인은 "댓글이 가능한 영상인지" 자체를 보장하지는 않습니다.
공개/일부공개라도 채널이나 영상 설정에서 댓글을 막아 두었을 수 있으므로, 19장은
댓글 활성화 여부와 영상의 적절성을 별도로 다시 확인합니다.

`--handoff`와 `--authorize-new-attempt`, 두 `--reconcile-*` 명령은 이전 Insert
시도로 이미 생성된 Receipt만 있으면 동작해야 하는 복구/제어용 명령입니다. 그 뒤
원본 MP4나 17장 QA 보고서가 옮겨졌거나 더 이상 없어도(예: 업로드 시도 뒤 정리
과정에서 원본 파일을 옮기거나 지운 경우) 계속 동작해야 합니다. 그래서 이 네
명령은 Plan 필드(제목·태그·SHA-256 형식·채널 handle 형식 등)만 검사하고, MP4를
읽거나 해시를 다시 계산하지 않습니다. 다만 Plan과 Receipt의 `video_sha256`·
`channel_handle_expected`(→ `channel_handle`)·`title`·`made_for_kids`가 서로
다르면(예: Plan 파일만 나중에 고쳤다면) BLOCKED로 남습니다. Preview와 실제
업로드(`--execute`, 위 네 명령 없음)는 여전히 MP4 존재·SHA-256 일치·QA
`PASS`/`UPLOAD READY`를 모두 요구합니다.

## 기능 검증

```bash
python3 -m unittest discover -s tests -v
python3 -m pytest tests -q
python3 -m compileall -q scripts tests
```

`tests/test_chapter18_upload.py`의 두 단계 발행·나중의 명시적 공개 전환(현재/Legacy
Receipt 모두, 정체성 불일치 차단 포함)·Insert 대기·불명 상태·Reconcile·Tombstone·
`--authorize-new-attempt`/소비(1회 Insert 보장, Crash 후 재구성, 재사용 ID 차단
포함)·아동용 설정 보존·공개/일부공개 확인이 필요한 Handoff 테스트는 Mock만
사용하며 `.secrets/`나 실제 YouTube API를 읽지 않습니다. `python3 -m unittest
discover -s tests -v` 기준 96건 중 2건은 17장이 요구하는, 아직 만들지 않은 최종
로마 콘크리트 MP4가 있어야 실행되는 기존 Chapter 17 검사
(`tests/test_chapter17_review.py`)이며 나머지는 모두 실행되어 통과합니다.

## 공식 AI Studio WAV 가져오기

작업 폴더의 source/audio/voice-import.json에 일곱 장면의 대본과 Charon 모델·음색·실제 WAV 파일·해시를 연결한 뒤 등록합니다. 입력 형식은 make_roman_concrete_short.py의 import-voice 안내를 따릅니다. 승인 없이 유료 호출을 대신 실행하지 않습니다.

```sh
python3 scripts/make_roman_concrete_short.py init
python3 scripts/make_roman_concrete_short.py import-voice
```

## 검수한 파일로 업로드 계획 준비

기본 업로드 계획은 독자 채널과 해시를 비운 서식입니다. 실제 선택 파일과 같은 영상의 QA를 지정해 `python3 scripts/prepare_upload_plan.py --video <MP4> --qa-report <QA JSON> --channel-handle <내 핸들> --output <새 계획 JSON>`으로 준비합니다. 실제 업로드는 하지 않습니다. 승인한 제목·설명을 담은 서식은 `--metadata`로 지정합니다. Publisher는 현재 파일·계획·QA의 해시가 다르면 차단합니다.

화면 검토 JSON에는 첫 검사 보고서의 `video_sha256`, `contact_sheet_sha256`, `policy_sha256`과 실제 관찰한 판단을 기록합니다. 해시가 없거나 파일이 바뀐 과거 판단은 통과 근거로 쓰지 않습니다.
