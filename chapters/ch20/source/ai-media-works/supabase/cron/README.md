# 10분마다 자동 실행 준비 (Supabase Cron) — 기본은 꺼짐

이 폴더에는 **실행되는 코드가 없습니다.** 나중에 배포한 뒤 사람이 직접 붙여 넣을 SQL과 그 절차만 적어 둡니다.
`supabase/migrations/`의 SQL은 테이블과 함수만 만들고, 일정(schedule)은 만들지 않습니다 — 즉 **아무것도 하지 않은 상태가 기본값**입니다.

이 문서의 SQL에는 열쇠 값이 한 글자도 들어 있지 않습니다. 열쇠는 Supabase Vault에 따로 넣고, SQL은 그 이름만 부릅니다.

> 이 저장소에서는 아래 절차를 **실제로 실행하지 않았습니다.** 실제 배포·일정 등록은 사람이 판단해서 하는 일이고,
> 등록하면 그때부터 10분마다 실제 답글이 나갈 수 있습니다.

## 먼저 확인할 것

1. 서버가 배포되어 있고 `https://<내-서버>/api/auto-reply/status`가 응답한다.
2. 자동답글을 **끈 상태**로 한 번 확인했다 (`status`의 `settings.enabled`가 `false`).
3. 서버에 `AUTO_REPLY_SCHEDULER_SECRET`을 넣어 두었다. 이 값이 없으면 `/api/auto-reply/run`은 누가 불러도 항상 거절합니다.
4. 이 열쇠는 아무도 추측할 수 없는 긴 임의의 문자열이어야 합니다. 만드는 예:

   ```bash
   openssl rand -base64 32
   ```

   만든 값은 서버의 환경변수와 아래 Vault 두 곳에만 넣습니다. 화면 캡처·대화·Git·문서에는 남기지 않습니다.

## 1단계 — 확장 기능 켜기

Supabase 대시보드의 SQL Editor에서:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

## 2단계 — 주소와 열쇠를 Vault에 넣기

값은 SQL 편집기에 **직접 타이핑**합니다. 이 문서에는 예시 이름만 있습니다.

```sql
-- 이미 있으면 지우고 다시 넣습니다. 이름은 아래 3단계와 정확히 같아야 합니다.
select vault.create_secret('https://내-서버-주소/api/auto-reply/run', 'ch20_run_url');
select vault.create_secret('여기에-내가-만든-실행-열쇠', 'ch20_scheduler_secret');
```

넣은 뒤 이름만 확인합니다 (값은 보지 않습니다):

```sql
select name from vault.secrets where name like 'ch20_%';
```

## 3단계 — 일정 등록 (여기서부터 실제로 답글이 나갈 수 있습니다)

```sql
select cron.schedule(
  'ch20-auto-reply-run',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'ch20_run_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- 열쇠는 헤더로만 갑니다. URL에 넣으면 접속 기록에 남습니다.
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'ch20_scheduler_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
```

`*/10 * * * *`은 10분마다입니다. 회당·하루 전송 개수 상한 없이 검사를 통과한 댓글을 실행 시간 안에서 순서대로 처리합니다.

## 4단계 — 등록됐는지 확인 (이건 "보냈다"는 뜻이 아닙니다)

```sql
select jobid, jobname, schedule, active from cron.job where jobname = 'ch20-auto-reply-run';
```

여기까지가 **등록 성공**입니다. 등록 성공은 서버가 일을 제대로 했다는 뜻이 **아닙니다.** 등록 다음으로 확인해야 하는 층이 세 개 있습니다.

| 무엇을 보는가 | 어디서 보는가 | 성공의 의미 |
|---|---|---|
| 일정이 돌았는가 | `cron.job_run_details` | Postgres가 위 SQL을 실행했다 |
| 요청이 서버에 닿았는가 | `net._http_response` | HTTP 응답을 받았다 (200이면 서버가 대답했다) |
| 서버가 무엇을 했는가 | `/api/auto-reply/status`, 또는 응답 본문의 `outcome` | 실제로 보냈는지, 건너뛰었는지, 멈췄는지 |

```sql
-- 일정이 돌았는지 (실행 기록에는 이름이 없어서 cron.job과 이어 봅니다)
select d.runid, d.status, d.return_message, d.start_time
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where j.jobname = 'ch20-auto-reply-run'
order by d.start_time desc
limit 10;

-- 요청이 어떤 답을 받았는지 (본문의 outcome을 꼭 읽으세요)
select id, status_code, content, created
from net._http_response
order by created desc
limit 10;
```

`/api/auto-reply/run`은 **정상 동작이면 항상 HTTP 200**입니다. 0건 전송도, 멈춤(halt)도 200입니다.
일정이 200이 아닌 응답을 재시도하면 곤란한 경우가 하나 있는데, 그게 바로 멈춤입니다 — 멈춘 실행을 다시 부르는 일은 절대 없어야 하므로,
"무슨 일이 있었는지"는 상태 코드가 아니라 응답 본문의 `outcome`에 담습니다.

| 본문의 `outcome` | 뜻 | 할 일 |
|---|---|---|
| `sent` | 답글 1개를 보냈고 YouTube가 id를 확인해 줬다 | 없음 |
| `no_target` | 보낼 대상이 없었다 (가장 흔한 정상 결과) | 없음 |
| `already_recorded` | 그 댓글은 이미 기록이 있다 | 없음 |
| `disabled` | 자동답글이 꺼져 있다 | 켜야 한다면 사람이 켠다 |
| `halted_result_unknown` | 결과를 확인하지 못했고 자동답글이 꺼졌다 | **사람이 확인** (아래) |
| `video_check_failed` | 승인한 영상이 더는 조건을 만족하지 않는다 | 영상 공개 범위·소유 확인 |

## 멈추기

```sql
select cron.unschedule('ch20-auto-reply-run');
```

일정을 지우는 것과, 자동답글 자체를 끄는 것은 다릅니다. 급하면 **둘 다** 하세요:
`/api/auto-reply/stop`으로 서버 쪽 스위치를 끄고, 위 명령으로 일정을 지웁니다.
스위치가 꺼져 있으면 일정이 계속 돌아도 매번 `disabled`만 돌려주고 아무것도 보내지 않습니다.

## `halted_result_unknown`이 나왔을 때

답글이 나갔는지 안 나갔는지 확인되지 않은 경우입니다. 자동답글은 이미 꺼졌고, 같은 댓글을 다시 보내지 않도록 기록과 잠금을 유지합니다.

1. YouTube에서 그 원래 댓글과 답글을 사람이 확인합니다. 작성 채널이 같다는 이유만으로 이번 프로그램의 전송 성공이라고 단정하지 않습니다.
2. 기록은 결과 미확인으로 남고, 일반 `stop`·`enable`으로 중단을 해제할 수 없습니다. 꺼진 예약 실행이 자동으로 결과를 복구하지도 않습니다.
3. 실제 결과 확인 전에는 잠금를 돌려주거나 재전송하지 않습니다. 이 실습에는 자동 복구와 중단 해제 기능을 추가하지 않습니다.
4. 일반 중지는 결과 미확인 중단과 다릅니다. 일반 중지에서 다시 예약을 켤 때는 `/status`의 대상 영상과 기준 시각을 확인하고 `/enable`에 `videoId`, `activatedAt`을 함께 전달합니다. 기준 시각과 기존 처리 기록은 유지됩니다.

## 이 문서에 없는 것

Worker, 큐, 별도 실행 서버, 모니터링 도구. 10분마다 HTTP 한 번을 부르는 일정 하나가 전부입니다.

## 서버 처리 결과 확인

예약 등록 성공과 HTTP 요청 도착은 댓글 전송 성공과 다릅니다. 인증된 `/api/auto-reply/status` 또는 로컬 5단계 **상태 확인**에서 최근 실행을 확인하세요. 기본 화면은 실행 종류·완료 시각·전송 수를 보여 주고, 펼쳐보기는 `runId`, `trigger`, `startedAt`, `completedAt`, `outcome`, `consideredCount`, `humanReviewCount`, `failureCount`, `sentCount`를 보여 줍니다. `completedAt: null`은 실행 중 또는 중단된 기록이며, 전송 0건으로 완료한 실행과 다릅니다. 기록에는 댓글 원문·작성자·비밀값이 없습니다.

일반 중지는 예약 실행만 끕니다. 결과 미확인 중단은 수동 승인 전송도 차단하며 `enable`로 해제되지 않습니다. lease가 만료돼도 자동으로 다른 전송을 시작하지 않습니다. 실제 결과 확인 전에는 잠금를 되돌리지 마세요.
