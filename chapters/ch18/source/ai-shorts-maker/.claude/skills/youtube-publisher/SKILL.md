---
name: youtube-publisher
description: 검수를 통과한 영상을 내 YouTube 채널에 올린다. 모든 업로드는 비공개(private)로 먼저 생성하고, 공개/일부공개 요청은 같은 video ID의 상태만 별도로 바꾼다. 영상 제작과 검수에는 사용하지 않는다.
argument-hint: <올릴 영상>
---

# YouTube Publisher

입력: `$ARGUMENTS`

18장에서 만든 게시 담당이다.

| 요청 | 실행 |
|---|---|
| 올려줘 | 비공개로 업로드 |
| 공개/일부공개로 올려달라는 명확한 요청(아직 업로드 전) | 먼저 비공개로 업로드한 뒤, 같은 실행 안에서 같은 video ID의 상태만 별도로 변경 |
| 이미 비공개로 끝난 영상을 나중에 공개/일부공개로 바꿔달라는 명확한 요청 | 새로 Insert하지 않고, 그 Receipt가 Plan과 정체성이 맞는지 다시 확인한 뒤 같은 video ID의 상태만 별도로 변경 |

## 업로드

1. 대상 MP4의 checksum과 최신 검수 결과가 일치하고 `UPLOAD READY`인지 확인한다.
2. 제목·설명·아동용 설정·공개 상태·대상 채널을 Preview로 보여준다.
3. 실행한다.

```
python3 scripts/upload_private_video.py --plan <plan.json>                          # Preview
python3 scripts/upload_private_video.py --plan <plan.json> --execute                 # 비공개 업로드
python3 scripts/upload_private_video.py --plan <plan.json> --execute --privacy public  # 공개 요청
```

모든 업로드는 `videos.insert`로 항상 비공개(private)를 먼저 만든다. 공개나
일부공개는 처음부터 그렇게 insert하지 않으며, Insert가 끝난 같은 video ID에 대한
별도의 `videos.update` 호출로만 이뤄진다. 이 상태 변경은 Insert에 쓰는 Upload
Token/Scope와는 다른 Status Token/Scope를 쓴다.

모든 상태 변경 호출은 `status.privacyStatus`와 함께 `status.selfDeclaredMadeForKids`도
같이 보낸다. `videos.update`는 지정한 `part`의 모든 mutable 속성을 요청 값으로
덮어쓰므로, 이 필드를 빼면 16장에서 확정한 아동용 설정이 삭제될 수 있다. 이 필드가
없는 예전 Receipt는 값을 추측하지 않고 `videos.list`로 현재 값을 먼저 확인하며,
확인할 수 없으면 상태 변경을 하지 않고 BLOCKED로 남긴다.

**이미 비공개로 끝난 뒤, 나중에 별도로 공개를 요청받았을 때**: 새로 Insert하지
않는다. `--privacy`를 이번 요청에서 명시적으로 받았고, 그 값이 Receipt가 확인한
실제 공개 상태와 다를 때만 Receipt의 정체성(해시·채널·제목·아동용 설정)을 Plan과
다시 맞춰본 뒤 같은 video ID로 상태 변경만 시도한다. 정체성이 맞지 않으면 Receipt를
건드리지 않고 BLOCKED로 남기고, 명시한 값이 실제 값과 같으면 API를 부르지 않고
ALREADY UPLOADED로 남긴다. 두 단계 발행 이전의 Legacy Receipt는 그 값이 비공개일
때만 같은 방식으로 다룬다.

## Insert 시도의 결과가 미해결일 때

- Insert 호출이 Kill/Crash로 중단되거나(`insert-pending`), 예외를 던지거나, 응답에
  video ID가 없으면(`insert-ambiguous`) "성공도 실패도 아닌 확인 불가" 상태로 남기고
  이후의 모든 자동 재시도를 막는다.
- Receipt JSON을 손으로 고치거나 지우지 않는다. 대신 아래 두 명령만 쓴다. 둘 다
  두 상태 모두에 동작하며, Insert를 0건 수행한다. 검증 절차의 자세한 내용은
  `COMMANDS.md`를 참고한다.

```
python3 scripts/upload_private_video.py --plan <plan.json> --execute --reconcile-video-found <VIDEO_ID>
python3 scripts/upload_private_video.py --plan <plan.json> --execute --reconcile-not-found --confirm-studio-checked
```

- **영상이 있는 경우**: Studio에서 확인한 실제 video ID를 `--reconcile-video-found`로
  넘긴다. 채널 identity(핸들로부터 독립적으로 해석한 채널과 인증된 계정을 모두
  비교)·정확한 제목·`started_at` 기준 앞뒤 24시간 이내·확인된 공개 상태/아동용
  설정이 모두 일치해야 하며, 하나라도 다르면 BLOCKED로 남고 Insert/Update는
  0건이다. Studio는 로컬 SHA-256을 보여주거나 비교해줄 수 없으므로 이 값으로는
  검증하지 않는다. 성공하면 Receipt를 known-ID 상태로 바꾸며, 이 명령 자체는
  상태 변경을 호출하지 않는다.
- **영상이 없는 경우**: 사람이 Studio를 확인했다는 명시적 확인
  (`--confirm-studio-checked`) 없이는 진행하지 않는다. **확인되지 않은 결과는
  재-Insert 허가가 아니다.** 확인되면 Insert를 절대 하지 않고 기존 Receipt를
  Audit 기록으로 `archive/`에 남긴 뒤, 원래 Receipt 파일은 지우지 않고 그 자리에서
  `tombstone` 상태로 덮어쓴다. 이 영상 해시는 이후 이 도구의 평소 실행으로는
  영구히 Insert가 막힌다. 정말로 새 업로드가 필요한 드문 경우에만, 사람이
  `--authorize-new-attempt <ATTEMPT_ID> --confirm-duplicate-risk`로 따로 승인하고
  그 뒤 별도의 평소 `--execute`가 그 승인을 소비해 딱 한 번만 Insert한다 — 이
  Skill은 그 승인을 대신 수행하지 않으며, 절차는 COMMANDS.md를 참고한다.
- Receipt 파일이 손상된 JSON이면 Traceback 없이 BLOCKED로 남고 Insert/Update를
  0건 수행한다. Receipt는 항상 원자적으로 쓴다(임시 파일+fsync+chmod 600+`os.replace`)
  므로 절반만 쓰인 Receipt가 남지 않으며, Archive 파일명은 충돌 안전하게 골라
  기존 Audit 기록을 조용히 덮어쓰지 않는다.

## 상태 변경이나 확인이 실패할 때

- video ID를 이미 아는 상태에서 상태 변경(`videos.update`)이나 그 뒤 확인
  (`videos.list`)이 실패하면 Receipt는 "비공개 업로드 완료 / 공개 미완료
  (public-incomplete)"로 남긴다.
- 재시도는 그 Receipt의 video ID로 상태 변경만 다시 시도한다. Insert는 0건, 다시
  하지 않는다.

## PART 6 인계(Handoff)

- PART 6로 넘기는 정보는 video URL/ID와 예상 채널 정체성뿐이다. 다음 명령으로만
  얻는다.

```
python3 scripts/upload_private_video.py --plan <plan.json> --handoff
```

- 이 명령은 `status_state=complete`인 Receipt(또는 그와 동등한 Legacy Receipt)이면서
  실제로 확인된 공개 범위가 `public`/`unlisted`일 때만 성공한다. 완료됐지만 여전히
  `private`인 Receipt는 성공으로 보지 않는다 — 19장은 시청자가 실제로 보고 댓글을
  남길 수 있는 영상이 필요하기 때문이며, 같은 video ID에 나중에 별도로
  `--privacy public`(또는 `unlisted`)을 먼저 명시해야 한다고 안내한 뒤 BLOCKED로
  남는다(privacy만으로 댓글 가능이 보장되지는 않으며, 19장이 댓글 활성화와 영상
  적절성을 별도로 다시 확인한다). `public-incomplete`·`insert-pending`·
  `insert-ambiguous`·`tombstone`·`authorized-new-attempt`도 완료된 발행 인계가
  아니므로 BLOCKED(출력 없음)로 남는다. MP4 경로·Token·Secret·Receipt 내용은 절대
  출력하지 않으며, PART 6 저장소로 파일을 복사하지 않는다.
- `--handoff`·`--authorize-new-attempt`·두 `--reconcile-*`는 이전 Insert 시도로
  이미 생성된 Receipt만 있으면 동작해야 하는 복구/제어용 명령이라, 그 뒤 원본 MP4나
  17장 QA 보고서가 옮겨지거나 없어져도 동작한다(매체 파일을 다시 읽지 않는다). 다만
  Plan과 Receipt의 SHA-256·채널 handle·제목·아동용 설정이 서로 다르면 MP4 유무와
  무관하게 BLOCKED로 남는다. Preview/실제 업로드(`--execute`, 위 네 명령 없음)는
  여전히 MP4 존재·SHA-256 일치·QA `PASS`/`UPLOAD READY`를 모두 요구한다.

## 경계

- OAuth Token·Secret·Receipt는 Git 밖 `.secrets/chapter-18/`에만 두고, 결과·원고·
  로그·Part 6로 절대 넘기지 않는다.
- Part 6로 넘기는 정보는 `--handoff` 출력(video URL/ID와 예상 채널 정체성)뿐이다.
  Token·Secret·Receipt 내용은 넘기지 않는다.
- 같은 영상 파일은 한 번만 올린다. Receipt가 있으면 다시 올리지 않고 실제 상태를
  먼저 확인한다.
- 댓글 작업, 대량 삭제, 채널 설정 변경은 이 Skill 범위가 아니다.
- 결과에는 video ID, 확인한 공개 상태, 실행 시각을 남긴다.
- API 응답과 실제 YouTube 상태가 다르거나 확인할 수 없으면 성공으로 단정하지 않는다.
