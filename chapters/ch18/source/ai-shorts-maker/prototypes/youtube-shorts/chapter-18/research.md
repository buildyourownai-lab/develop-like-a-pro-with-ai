# 18장 OAuth·private upload 기준

확인일: 2026-08-21 / 갱신: 2026-09-14 (Tombstone 이후 정말로 새 업로드가 필요한
드문 경우를 위해 `--authorize-new-attempt`/`--confirm-duplicate-risk`라는 별도의
명시적 사람 승인 경로를 추가하고, `--handoff`가 완료 상태에 더해 실제로 확인된
공개/일부공개 상태까지 요구하도록 강화. 절차는 COMMANDS.md 참고. 이전 갱신(같은
날): 이미 `status_state=complete`로 끝난 비공개 Receipt에, 사람이 나중에 별도로
명시한 공개/일부공개 요청이 항상 ALREADY UPLOADED로 막히던 결함을 고쳐, 정체성이
확인되는 한 같은 video ID의 상태 변경만 허용(W003). 이전 갱신: 미확인 결과가
재-Insert를 허가하지 않도록 Tombstone 도입, `insert-pending`도 Reconcile 대상에
포함, `--handoff`를 완료 Receipt로 한정)

- 업로드는 항상 YouTube Data API `videos.insert`로 `status.privacyStatus=private`을 먼저 만든다. `notifySubscribers=false`, 1건으로 제한한다.
- Insert에는 `https://www.googleapis.com/auth/youtube.upload` Scope만 요청한다(Upload Token). 이 Token은 상태 변경에 쓰지 않는다.
- 대상이 분명한 공개(또는 일부공개) 업로드 요청은 Insert 뒤 같은 video ID에 대해서만 `videos.update` (`part=status`)를 별도로 호출한다. 이 상태 변경 호출은 `https://www.googleapis.com/auth/youtube` Scope의 별도 Token(Status Token)을 쓴다. 공식 `videos.update` 문서는 `https://www.googleapis.com/auth/youtube`, `https://www.googleapis.com/auth/youtubepartner`, `https://www.googleapis.com/auth/youtube.force-ssl` 세 Scope 중 하나면 된다고 밝히므로 `youtube` Scope 유지는 근거가 있다.
- **`videos.update`는 지정한 `part`에 들어있는 모든 mutable 속성을 요청 Body 값으로 덮어쓴다.** 공식 문서: "this method will override the existing values for all of the mutable properties that are contained in any parts that the request body specifies" / "If your request does not specify a value for a property that already has a value, the property's existing value will be deleted." 따라서 `part=status` 상태 변경 호출은 `status.privacyStatus`뿐 아니라 `status.selfDeclaredMadeForKids`도 항상 같이 보낸다. 이 값을 빼면 16장에서 확정한 아동용 설정이 삭제될 수 있다.
  - 새 Receipt는 Insert 시점에 `made_for_kids`를 저장해 두고 그 값을 그대로 상태 변경 Body에 넣는다.
  - 이 필드가 없는 예전(Legacy) known-ID Receipt는 값을 추측하지 않고 `videos.list` (`part=status`)로 현재 `selfDeclaredMadeForKids`를 먼저 읽어 확인한 값만 쓴다. 확인할 수 없으면(응답에 항목이 없거나 값이 없으면) 상태 변경을 하지 않고 BLOCKED로 남긴다.
- 상태 변경 응답이 불명확하면(privacyStatus를 읽을 수 없으면) `videos.list` (`part=status`)로 실제 상태를 확인한 뒤에만 Receipt를 갱신하거나 다음 시도를 진행한다.
- 상태 변경이 실패하면 Receipt는 "비공개 업로드 성공(actual_privacy=private), 공개 미완료(status_state=public-incomplete)"로 남는다. 재시도는 Receipt의 video ID로 상태 변경만 다시 시도하며 Insert는 다시 하지 않는다.
- 공식 `videos.insert` 문서는 현재 Video Uploads quota bucket에서 1회 비용 1 unit, 하루 100회라고 표시한다. 오래된 1,600-unit 설명은 사용하지 않는다.
- 2020-07-28 이후 생성된 미검증 API Project의 업로드는 Audit 전 private viewing mode로 제한될 수 있다. 공개 전환도 같은 프로젝트 검증 제한을 우회하지 않는다.
- OAuth Client Secret과 두 종류의 Token(Upload Token, Status Token)은 `.secrets/chapter-18/`에만 저장하고 Git·원고·로그에 넣지 않는다.
- **Receipt 쓰기는 항상 원자적이다.** `write_receipt`는 같은 디렉터리에 임시 파일을
  만들어 쓰고 flush + `os.fsync` + `chmod 600` + `os.replace`로 교체하며, 지원되는
  플랫폼에서는 부모 디렉터리도 fsync한다. 실패하면 임시 파일을 지우고 예외를 다시
  던지므로, 어떤 리더도 절반만 쓰인 Receipt를 보지 않는다. Archive 파일명은
  `O_CREAT|O_EXCL`로 이름을 먼저 확보해, 같은 초에 두 번 Archive해도 기존 Audit
  기록을 조용히 덮어쓰지 않는다(충돌 시 `-1`, `-2` ... 접미사를 붙인다).

## `status_state=complete`인 Receipt를 나중에 별도로 다시 여는 것(W003)

`videos.insert`로 비공개 업로드가 끝나 `status_state=complete`가 된 Receipt는, 그
직후 같은 `--execute` 실행 안에서 공개로 바꾸는 것과, 사람이 나중에 별도의 실행에서
`--privacy public`을 다시 명시하는 것을 구분해야 한다. 이전 구현은 이 둘을 구분하지
않고 `status_state=complete`이면 항상 ALREADY UPLOADED로 막아, "공개 전환은 같은
영상의 별도 상태 변경"이라는 설계 약속과 어긋나게 나중의 명시적 재승인 흐름을 막았다
(W003 반려 사유).

- **CLI에 명시된 `--privacy`만 신호로 쓴다.** Plan 파일의 기본 `privacy` 값은 신호로
  쓰지 않는다 — 그렇지 않으면 아무 플래그 없이 두 번째로 실행했을 때 Plan에 적힌
  값과 다르다는 이유만으로 뜻하지 않게 다시 열릴 수 있다.
- **명시한 값이 확인된 실제 값과 같으면 여전히 ALREADY UPLOADED, API 호출 0건.** 이
  경로는 상태를 "바꾸는" 것이 아니라 "이미 그 상태다"를 확인하는 것뿐이므로 Insert도
  Update도 하지 않는다.
- **다시 열기 전에 Receipt의 정체성을 Plan과 다시 확인한다.** Receipt가 위치는
  video 해시로 찾았어도, 그 내용(제목·채널 handle·아동용 설정)이 그 사이 Plan
  편집으로 달라졌을 수 있으므로 `verify_receipt_matches_plan`으로 다시 확인하고,
  하나라도 다르면 Receipt를 건드리지 않고 BLOCKED로 남긴다.
- **Receipt를 먼저 원자적으로 고쳐 쓴 뒤에만 상태 변경을 부른다.** `requested_privacy`/
  `status_state`를 새 목표로 바꿔 쓴 다음 기존 `apply_status_change`(같은 video ID의
  `videos.update`)를 그대로 재사용한다. 이 경로는 `videos.insert`를 절대 부르지
  않는다. 상태 변경이 실패하면 방금 쓴 `public-incomplete` Receipt가 남아, 다음
  평소 재시도가 Insert 없이 상태 변경만 다시 시도한다.
- **아직 목표가 적용되지 않은 `public-incomplete` Receipt에 또 다른 목표를 명시하면**
  같은 정체성 확인을 거쳐 목표만 새로 바꾼다. 확인에 실패하면 기존 목표를 그대로
  둔 채 BLOCKED로 남긴다 — 확인되지 않은 재목표 지정으로 Receipt를 흔들지 않는다.
- **두 단계 발행 이전의 Legacy Receipt(`privacy` 필드 하나)는 그 값이 `private`일
  때만 이 경로의 안전한 시작점이다.** 정체성 확인을 통과하면 현재 스키마로 변환한
  뒤 같은 상태 변경 경로를 탄다. `private`가 아닌 Legacy 값이나 정체성이 맞지 않는
  Legacy Receipt는 절대 추측해서 변환하지 않고 기존 동작(ALREADY UPLOADED 또는
  BLOCKED)을 그대로 유지한다.

## Insert 시도가 미해결 상태일 때의 재구성(Reconcile)

Insert 호출이 예외를 던지거나 응답에 video ID가 없으면(`insert-ambiguous`), 또는
그 호출 자체가 Kill/Crash로 중단되면(`insert-pending`), 서버가 실제로 영상을
만들었는지 클라이언트는 알 수 없다. 이 상태에서 Receipt JSON을 손으로 고치는
것은 안전하지 않고(형식이 깨지면 재현 불가), YouTube Studio는 로컬 SHA-256을
보여주거나 비교해줄 수 없다. 그래서 손으로 편집하는 대신 `--reconcile-video-found`/
`--reconcile-not-found` 두 명령만 허용하며, 절차와 각 검증 항목은 `COMMANDS.md`에
정리했다. 핵심 설계 근거만 여기 남긴다.

- **채널 검증은 두 번 독립적으로 조회해 비교한다.** `channels.list(mine=true)` 하나만으로는
  "지금 로그인한 계정 소유"만 증명할 뿐 "그 계정이 Receipt가 기대하는 Brand 계정과
  같다"는 것을 증명하지 못한다 — 잘못된 Brand 계정으로 인증한 채 그 계정 소유의(그러나
  receipt와 무관한) 영상을 넘기면 `mine=true`만으로는 통과해 버린다. 그래서 기대 채널
  ID를 `channels.list(forHandle=...)`로 handle로부터 독립적으로 해석한 뒤 인증된 채널과
  비교한다.
- **시간 검증은 `started_at`에 양쪽으로 고정한다.** `abs(published - started) <= 24h`.
  이전 구현은 상한을 `now() + 24h`로 두어, Reconcile 자체가 시도 시각보다 한참 뒤에
  실행되면 그 사이에 새로 올라온 동명 영상도 통과할 수 있었다.
- **확인되지 않은 값은 추측하지 않는다.** `privacyStatus`/`selfDeclaredMadeForKids`가
  응답에 없거나 형식이 다르면(이전 구현은 `privacyStatus`가 없으면 `private`로 추정했다)
  BLOCKED로 남기고 Receipt는 그대로 둔다.
- **영상이 없는 경우, 확인되지 않은 결과는 재-Insert 허가가 아니다.** `--reconcile-not-found`는
  Insert를 절대 하지 않고, 기존 Receipt를 Audit 기록으로 `archive/`에 보존한 뒤 원래
  Receipt 파일은 지우지 않고 그 자리에서 `tombstone` 상태로 덮어쓴다. 이 영상 해시는
  이후 이 도구의 자동 실행으로는 영구히 Insert가 막힌다. YouTube는 새로 만든 영상을
  Studio/검색에 늦게 보여줄 수 있으므로 이 확인은 "지금 시점 스냅샷"일 뿐 "영상이
  없다는 보장"이 아니지만, 스냅샷이 나중에 틀렸더라도 이 도구의 어떤 나중 평소 실행도
  스스로 다시 Insert하지 않는다.

Receipt 파일이 손상된 JSON이면(예: 수동 편집 실수) Traceback 없이 깨끗하게 BLOCKED로
남고 Insert/Update를 0건 수행한다.

## Tombstone 이후 정말로 새 업로드가 필요할 때는 명시적 사람 승인이 필요하다

진짜 새 업로드가 필요하면 `--authorize-new-attempt <ATTEMPT_ID> --confirm-duplicate-risk`로
사람이 Studio를 별도로 확인하고 별도의 유일한 Attempt ID로 승인해야 한다. 이 명령
자체는 Insert/Update를 0건 수행하며, Receipt를 `tombstone`에서 `authorized-new-attempt`
상태로만 원자적으로 옮긴다(이전 Tombstone/Archive/시각을 그대로 보존). 이 승인을
실제로 소비해 딱 한 번 Insert를 수행하는 것은 그 뒤 별도의, 아무 특별한 Flag도
없는 평소 `--execute` 뿐이며, 소비된 순간 다시 쓸 수 없다(재사용 ID·잘못된
상태·확인 실패·Crash 후 재시도는 모두 Insert 0건으로 막힌다). 절차와 검증 목록은
COMMANDS.md의 "Tombstone 이후 정말로 새 업로드가 필요할 때" 절을 참고한다.

## `--handoff`는 완료되고 확인된 공개/일부공개 Receipt에서만 성공한다

`--handoff`는 `status_state=complete`(또는 그와 동등한 Legacy Receipt)이면서
실제로 확인된 공개 범위가 `public`/`unlisted`일 때만 성공(exit 0)한다. 19장은
시청자가 실제로 보고 댓글을 남길 수 있는 영상이 필요하므로, 완료됐지만 여전히
`private`인 Receipt는 성공으로 취급하지 않는다 — Whitelist를 출력하지 않고, 같은
video ID에 나중에 별도로 `--privacy public`(또는 `unlisted`)을 명시해야 한다고
안내한 뒤 BLOCKED로 남는다(privacy 하나만으로 댓글 가능 여부가 보장되는 것은
아니며, 19장이 댓글 활성화와 영상 적절성을 별도로 다시 확인한다). `public-incomplete`는
요청한 공개 범위가 아직 적용되지 않은 상태이므로 완료된 발행 인계가 아니다 —
video URL/ID·기대 채널 정체성 세 필드짜리 Whitelist로는 "요청이 실패한 채로 남아
있다"는 사실을 전달할 방법이 없다. `insert-pending`/`insert-ambiguous`/`tombstone`/
`authorized-new-attempt`도 같은 이유로 BLOCKED(exit 6, 출력 없음)이다.

## `--handoff`·`--authorize-new-attempt`·두 `--reconcile-*`는 원본 MP4/QA가 없어도 동작한다

이 네 명령은 이전 Insert 시도로 이미 생성된 Receipt만 있으면 동작해야 하는
복구·제어용 명령이다. 그 뒤 원본 MP4나 17장 QA 보고서가 옮겨지거나 더 이상
없어도(예: 업로드 시도 뒤 정리 과정에서 파일을 옮기거나 지운 경우) 계속 동작해야
한다. 그래서 `validate_plan_metadata`가 Plan의 나머지 필드(제목 길이·태그 형식·
SHA-256이 64자 hex인지·channel_handle이 `@`로 시작하는지 등)만 검사하고,
Preview/실제 업로드가 쓰는 `validate_plan`(MP4 존재·SHA-256 일치·QA PASS/UPLOAD
READY 확인)은 그대로 두 흐름 전용으로 남는다. 이어서 `verify_receipt_matches_plan`이
Receipt의 `video_sha256`·`channel_handle_expected`·`title`·(있다면) `made_for_kids`가
Plan과 일치하는지 확인하며, 하나라도 다르면(예: Plan 파일만 나중에 편집됐다면) MP4
유무와 무관하게 BLOCKED로 남는다.

공식 문서:

- https://developers.google.com/youtube/v3/docs/videos/insert
- https://developers.google.com/youtube/v3/docs/videos/update
- https://developers.google.com/youtube/v3/docs/videos/list
- https://developers.google.com/youtube/v3/docs/channels/list
- https://developers.google.com/youtube/v3/guides/uploading_a_video
- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/youtube/terms/api-services-terms-of-service

이번 장은 17장의 SHA-256이 같은 `UPLOAD READY` 영상만 허용한다. 현재 Preview와 일치하는 승인 코드 없이는 OAuth와 업로드를 실행하지 않는다. 업로드 뒤에는 YouTube Studio에서 채널·처리 완료·재생·private·제목·아동용 설정을 사람이 확인하고, 공개 전환을 요청했다면 그 상태 변경도 같은 방식으로 확인한다.
