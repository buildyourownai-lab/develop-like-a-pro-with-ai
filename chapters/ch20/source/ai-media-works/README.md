<p align="left"><img src="assets/brand/book-symbol.png" alt="책 심벌" width="13%"><img src="assets/brand/brand-divider.svg" alt="" width="4.1%"><img src="assets/brand/book-title.svg" alt="프로처럼 AI로 코딩 없이 개발하기" width="49.6%"><img src="assets/brand/brand-divider.svg" alt="" width="4.1%"><img src="assets/brand/repository-title.svg" alt="AI 미디어 운영" width="24.2%"></p>

# ai-media-works — 19·20장. 유튜브 댓글 읽기·분류·초안 미리보기와 답글 보내기

**19장(1~3단계):** 내 채널의 시험 영상 한 편에서 공개 또는 일부 공개(unlisted) 최상위 댓글을 최신순 최대 20개 읽고, 다섯 종류·세 처리 수준으로 나눈 뒤 자동답글 후보에만 짧은 한국어 초안을 만들어 **내 컴퓨터에서만** 미리 봅니다.

**20장(4~5단계):** 그 후보 중 사람이 승인한 것 하나에, 또는 10분마다 도는 예약 실행이 고른 댓글에 답글을 **실제로** 보냅니다. 쓰기 호출은 `comments.insert` 하나뿐이고, 회당·하루 전송 개수 상한 없이 조건에 맞는 댓글을 순서대로 처리합니다. 기본값은 **꺼짐**이며, 켜는 것도 끄는 것도 사람이 합니다.

---

# 빠른 시작

이 저장소에는 성격이 다른 세 가지 흐름이 있습니다. **A는 아무것도 보내지 않고, B와 C는 실제로 답글을 올립니다.** 섞어서 읽지 마세요.

| | 흐름 | 어디서 | 실제 전송 | 예약 실행이 필요한가 |
|---|---|---|---|---|
| **A** | 19장 읽기 전용 미리보기 (1~3단계) | 내 컴퓨터에서만 | 없음 | 아니오 |
| **B** | 20장 사람 승인 2단계 전송 (4단계) | 내 컴퓨터 또는 배포한 서버 | **있음** (1개) | **아니오 — 꺼져 있어도 됩니다** |
| **C** | 20장 예약 실행 (5단계) | 배포한 서버 | **있음** (10분마다 조건에 맞는 댓글) | 예 |

## 0. 공통 준비

```bash
npm install
cp .env.example .env.local   # 이름만 있는 예시입니다. 실제 값은 이 파일에만 직접 입력합니다.
npm run setup:youtube-comment-read -- <18장에서 받은 client_secret*.json 경로>
```

`.env.local`에 `GEMINI_API_KEY`, `GEMINI_MODEL`을 채우고, 두 자격증명은 아래 두 방식 중 **하나씩** 고릅니다.

- 내 컴퓨터: `YOUTUBE_OAUTH_CLIENT_JSON_PATH`, `YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH` (파일 경로 — 권장)
- 배포한 서버: `YOUTUBE_OAUTH_CLIENT_JSON`, `YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON` (JSON 또는 base64 값)

한 자격증명에 대해 두 이름을 동시에 채우면 서버는 그 자격증명을 **거절합니다.** 자세한 규칙은 [배포 서버의 자격증명](#배포-서버의-자격증명-파일-경로가-없는-곳) 절에 있습니다. OAuth 동의 절차는 [로컬 OAuth 설정](#로컬-oauth-설정-댓글-읽기) 절을 먼저 읽으세요.

## A. 19장 — 읽기 전용 미리보기 (내 컴퓨터)

```bash
npm run dev     # http://localhost:3000
```

화면의 1~3단계를 순서대로 누릅니다: 영상 확인 → 댓글 20개 읽기 → 분류·처리 수준·초안 미리보기. Supabase는 필요하지 않고, 이 흐름에는 **쓰기 호출이 하나도 없습니다.**

이 미리보기는 남의 댓글 원문을 화면에 띄우므로 배포한 서버에서는 닫힙니다. 정확히 말하면:

- `POST /api/video`, `POST /api/comments`, `POST /api/review` → `NODE_ENV=production`에서 **HTTP 404**
- 화면(`/`) 자체는 **HTTP 200**이고, 미리보기 대신 "배포된 서버입니다"라는 안내 화면을 보여 줍니다 (`src/app/production-preview-blocked.test.ts`, `src/app/page.tsx`)

## B. 20장 — 사람이 승인하는 2단계 전송 (예약 실행이 꺼져 있어도 됩니다)

먼저 19장 설정에 더해 `.env.local`에 `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`를 입력하고, 아래 배포 준비 절의 DB migration을 적용합니다. 이때 예약은 만들거나 켜지 않습니다. 상단 배너에서 19장 연결과 20장 저장소 준비를 따로 확인할 수 있습니다.

1. 로컬 브라우저의 1단계에서 내 시험 영상을 확인합니다.
2. 4단계 **이 영상을 답글 대상으로 정하기 (전송 0건)**를 누르고 대상·기준 시각 안내·한도를 확인해 저장합니다. 저장 응답의 기준 시각을 확인합니다. 예약 실행은 꺼져 있습니다.
3. 그 뒤 YouTube에 새 시험 댓글을 작성하고, 2단계에서 댓글을 다시 읽고 3단계에서 분류합니다. 기준 시각 이전의 댓글은 자동답글 대상이 아닙니다.
4. 후보 한 개를 고르고 **보낼 문장 준비하기**를 누릅니다. 아직 보내지 않습니다.
5. 영상·댓글·보낼 문장을 읽고, 실제 게시할 때만 **위 문장을 승인하고 답글 1개 보내기**를 누릅니다.
6. YouTube에서 실제 답글과 화면의 결과를 대조합니다. 같은 댓글을 다시 처리해도 추가 전송은 없어야 합니다.

한 건을 승인하는 일과 예약을 켜는 일은 별개입니다. 일반 **예약 실행 끄기** 뒤에도 사람이 새로 승인한 한 건은 보낼 수 있지만, **결과 미확인으로 중단된 상태에서는 둘 다 차단**됩니다. 기준 시각은 같은 대상에서 유지됩니다.

배포한 서버의 API를 직접 쓰는 예는 맨 아래 **API 참고**에 있습니다. 첫 실습에서 토큰 구조나 DB 함수를 직접 다룰 필요는 없습니다.

## C. 20장 — 예약 실행 (켜기 → 10분마다 → 끄기)

```bash
# 켜기 — 준비된 대상만 켭니다. 결과 미확인 중단은 해제하지 않습니다
curl -s -X POST https://<내-서버>/api/auto-reply/enable \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $AUTO_REPLY_OPERATOR_SECRET" \
  -d '{"videoId":"<영상 id>","activatedAt":"<status에서 확인한 기준 시각>"}'

# 상태 보기 — 켜짐/꺼짐, 대상 영상, 기준 시각, 오늘 사용량, 최근 기록(id·상태·시각만)
curl -s https://<내-서버>/api/auto-reply/status -H "Authorization: Bearer $AUTO_REPLY_OPERATOR_SECRET"

# 끄기 — 이후 예약 실행은 전송 0건입니다 (4단계 사람 승인 전송은 그 뒤에도 됩니다)
curl -s -X POST https://<내-서버>/api/auto-reply/stop -H "Authorization: Bearer $AUTO_REPLY_OPERATOR_SECRET"
```

`POST /api/auto-reply/run`은 사람이 부르는 경로가 아니라 10분마다 도는 일정이 부르는 경로입니다. `AUTO_REPLY_SCHEDULER_SECRET`이 설정돼 있지 않으면 **누가 불러도 항상 거절**합니다.

- **커서:** 한 번 실행은 한 페이지(20개)만 읽고, YouTube가 준 페이지 커서를 저장해 다음 실행이 그 뒤에서 시작합니다. 아직 답할 것이 남은 페이지는 커서를 넘기지 않고 다시 읽습니다(실행 시간이나 오류로 중단된 경우). 끝에 닿으면 다시 최신 페이지부터 돕니다. 그래서 대상이 20개보다 많아도 오래된 것이 영원히 안 보이는 일은 없습니다.
- **실행 기록:** 예약 실행이든 사람 승인 전송이든 실행마다 `ch20_auto_reply_runs`에 한 줄이 남습니다(트리거·결과·건수, 중간에 죽으면 `completedAt`이 빈 채로). 전송 0건인 실행도 남으므로 "일정이 왔는가"를 따로 확인할 수 있습니다. `/status`와 로컬 5단계에서 설정·오늘 사용량·최근 전송·최근 실행 기록을 확인합니다.
- **30일 삭제와 그 한계:** 오래된 전송·통계·실행 기록은 30일이 지나면 삭제됩니다(`SEND_RETENTION_DAYS = 30`). 이 삭제는 **`/api/auto-reply/run`이 불릴 때만** 일어납니다(꺼져 있어서 0건으로 끝나는 실행에서도 일어납니다). 즉 **일정을 등록하지 않았거나 `cron.unschedule`로 지웠으면 아무것도 삭제되지 않고 기록이 30일을 넘겨 남습니다.** 사람 승인 전송과 `/status`는 삭제를 하지 않습니다. 완전히 그만둘 때는 표를 사람이 지우세요. 승인한 채널·영상·기준 시각 한 줄은 애초에 30일 삭제 대상이 아닙니다.
- **일정과 배포 설정:** Vercel처럼 파일을 둘 수 없는 곳에서는 자격증명을 `..._JSON` 이름으로 넣습니다(아래 절). 일정은 [`supabase/cron/README.md`](supabase/cron/README.md)의 절차대로 사람이 직접 등록하고, 열쇠는 Supabase Vault에 넣어 `Authorization` 헤더로만 보냅니다 — URL·SQL·로그에는 넣지 않습니다. `/api/auto-reply/run`은 정상 동작이면 **항상 HTTP 200**이므로(0건도, 멈춤도) 무슨 일이 있었는지는 응답 본문의 `outcome`으로 봅니다. **일정 등록 성공은 전송 성공이 아닙니다** — 등록됐는지(`cron.job`), 요청이 닿았는지(`net._http_response`), 서버가 무엇을 했는지(`outcome`) 세 층을 따로 확인하세요.

---

## 이 장에 없는 것

Google Chat, Queue, Worker, 회원가입, AI 회사, 인사 댓글, 댓글 수정·삭제·차단, 영상 업로드·공개 범위 변경, 회원 화면, YouTube Analytics, 채널 전체 조회. 이전 판의 대표실·Worker 구현은 Git 역사와 원본 저장소에만 남아 있습니다.

이 저장소에서는 실제 전송·일정 등록·배포를 **실행하지 않았습니다.** 무엇이 확인되고 무엇이 확인되지 않았는지는 [`verification/README.md`](verification/README.md)에 있습니다.

## 준비물

- Node.js 20 이상
- 18장에서 만든 Google Cloud 프로젝트의 OAuth Desktop client JSON 파일 (client_secret*.json — 읽기 전용으로 재사용, 이 앱은 그 파일을 절대 덮어쓰지 않습니다)
- 댓글이 허용된 내 채널의 공개 또는 일부 공개(unlisted) 시험 영상 한 편
- 11장에서 사용한 Google AI Studio 계정의 Gemini API 키
- 20장을 실제로 쓸 때만: Supabase 프로젝트 하나

## 로컬 OAuth 설정 (댓글 읽기)

**정정 사항 (2026-09-14):** 이 절은 실제 계정으로 `commentThreads.list`를 불러본 뒤 바로잡았습니다. 소유가 확인된 공개 영상(`2HkP_1fahLQ`)에서 `videos.list`는 정상 응답했지만 `commentThreads.list`는 `youtube.readonly` 범위의 Token으로 HTTP 403 `insufficientPermissions`를 반환했습니다. Google YouTube Data API v3의 공식 Discovery 문서를 다시 확인한 결과, `commentThreads.list`/`comments.list`를 허용하는 범위는 `https://www.googleapis.com/auth/youtube.force-ssl` 하나뿐이며 `youtube.readonly`도, 18장 상태변경(status-change) Token이 가진 `https://www.googleapis.com/auth/youtube`도 그 목록에 없습니다. 이 장의 서버는 `channels.list`/`videos.list`/`commentThreads.list`를 부르므로, 이제 정확히 `youtube.force-ssl` 범위의 Token만 인정합니다 — **18장 Token(상태변경·읽기 전용 어느 쪽이든)은 더 이상 재사용할 수 없습니다.** 20장이 더하는 쓰기는 `comments.insert` 하나뿐이며, 같은 범위 안에 있어서 Token을 새로 만들 필요는 없습니다. Google 콘솔은 `youtube.force-ssl`을 "YouTube 데이터 관리"처럼 넓게 표시하지만, 이 저장소가 실제로 쓰는 것은 그 한 개뿐입니다 — 수정·삭제·차단·스팸 신고 경로는 없고, `src/app/bounded-write-surface.test.ts`가 "쓰기는 `src/lib/youtube/reply-client.ts` 한 파일의 한 호출뿐"임을 매 테스트마다 정적으로 재확인합니다.

이 장 전용의 **새 댓글 읽기 Token 파일**을 아래처럼 만드세요. 이 스크립트는 18장의 어떤 Token 파일도 읽거나 덮어쓰지 않습니다.

```bash
npm run setup:youtube-comment-read -- <18장에서 받은 client_secret*.json 경로>
```

이 명령은 항상 프로젝트 안의 고정된 한 경로(`.secrets/youtube-comment-read-oauth.json`)에만 저장합니다 — 저장 경로를 바꾸는 인자는 없습니다. 18장의 client JSON과 같은 경로이거나 프로젝트 밖 경로가 되는 것을 원천적으로 막기 위한 제약입니다.

실행하면:

1. 로컬 콜백 서버(`http://127.0.0.1:51823/oauth2callback`)가 실제로 대기 상태가 된 뒤에만 콘솔에 Google 동의 URL이 출력됩니다(포트 충돌 등으로 서버가 뜨지 못하면 URL을 출력하지 않고 즉시 오류로 끝납니다). 이 URL을 브라우저에 직접 열어 **사람이 직접** 동의합니다 (이 스크립트는 브라우저를 대신 열거나 동의를 자동으로 진행하지 않습니다).
2. 동의가 끝나면 위 콜백으로 리다이렉트되고, 스크립트가 이를 받아 PKCE·state 값을 검증한 뒤 Token을 교환합니다. 콜백 페이지는 고정된 안내 문구만 보여줍니다 — Google이 돌려준 오류 문구나 요청 URL을 그대로 되돌려주지 않습니다.
3. 부여된 범위에 `https://www.googleapis.com/auth/youtube.force-ssl`이 없거나 `refresh_token`이 없으면 저장하지 않고 실패로 끝냅니다 — 사람이 Google 계정의 **보안 → 타사 앱 액세스**에서 이 앱 접근을 제거한 뒤 다시 시도해야 합니다.
4. 성공하면 새로 검증된 Token만 owner-only 권한(0600)으로, 임시 파일에 먼저 쓴 뒤 원자적으로 옮겨 저장합니다(기존 파일이 있어도 검증 전에는 손대지 않고, 실패 시 임시 파일을 남기지 않습니다). 콘솔에는 파일 경로와 부여된 범위 이름만 출력하고, 인가 코드·Token·client secret 값은 어디에도 출력하지 않습니다.

취소(Ctrl+C), 콜백 오류, state 불일치, 잘못되거나 없는 범위, `refresh_token` 누락, 포트 충돌은 모두 Token을 저장하지 않고 명확한 오류로 끝나는 "닫힌 실패"입니다 — `scripts/tests/`의 자동 테스트가 이 경로들을 Mock HTTP/Mock 콜백으로 검증합니다(실제 브라우저·실제 Google 서버는 쓰지 않습니다). 이 정정된 흐름으로 실제 동의·Token 교환을 다시 실행해 확인하는 절차는 아직 이 저장소에서 완료하지 않았습니다 — 리뷰 후 실계정으로 재확인할 예정입니다.

**사람이 확인해야 하는 지점:** Google 동의 화면은 `youtube.force-ssl` 범위를 `YouTube 데이터 관리`처럼 넓은 관리 권한으로 표시하고, 이 플랫폼 범위 자체는 수정·삭제까지 허용합니다. 이 저장소의 고정 소스 코드가 실제로 실행하는 것은 조회 GET 네 개(`channels.list`, `videos.list`, `commentThreads.list`, 답글 확인용 `comments.list`)와 쓰기 POST 한 개(`comments.insert`)입니다 — `src/app/bounded-write-surface.test.ts`가 그 경계(쓰기는 한 파일의 한 호출, 다른 쓰기 메서드는 어디에도 없음)를 매 테스트마다 정적으로 재확인합니다. 동의 화면에서 이 범위가 요청됨을 확인하고, 이를 받아들일 때만 진행하세요. 문제가 있으면 Google 계정의 보안 설정에서 이 앱 접근을 제거하고 다시 실행하면 복구됩니다.

## 배포 서버의 자격증명 (파일 경로가 없는 곳)

Vercel 같은 서버리스 환경에는 위 Token 파일을 둘 곳이 없습니다 — 런타임 파일 시스템은 읽기 전용이고 `.env.local`은 배포되지 않습니다. 그래서 두 자격증명은 각각 **파일 경로** 또는 **값 자체** 중 하나로 줄 수 있습니다.

| 자격증명 | 값으로 줄 때 | 파일로 줄 때 |
|---|---|---|
| OAuth Desktop client JSON | `YOUTUBE_OAUTH_CLIENT_JSON` | `YOUTUBE_OAUTH_CLIENT_JSON_PATH` |
| 댓글용 Token JSON | `YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON` | `YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH` |

- 값은 **JSON 그대로** 또는 그 JSON을 **base64로 한 줄** 만든 것을 넣습니다. 배포 화면의 입력칸은 한 줄이라 여러 줄 JSON은 줄바꿈이 깨지기 쉬우므로 base64를 권합니다: `base64 < .secrets/youtube-comment-read-oauth.json | tr -d '\n'`. 표준 알파벳과 URL-safe 알파벳, 줄바꿈이 섞인 base64를 모두 받습니다.
- **한 자격증명에 두 이름을 동시에 채우면 그 자격증명을 거절합니다.** 어느 쪽을 쓸지 임의로 정하면, 잊고 남겨 둔 옛 비밀값이 계속 쓰이는데 증상은 엉뚱한 곳을 가리키게 됩니다. 오류 문구에는 충돌한 두 **이름만** 나오고 값은 나오지 않습니다.
- 두 자격증명은 서로 독립입니다. client는 값으로, Token은 파일로 주는 조합도 됩니다.
- 검사는 어느 쪽이든 **똑같이 엄격합니다.** 모양(`installed`, `client_id`/`client_secret`, `refresh_token`)과 범위(`youtube.force-ssl` **하나만** 정확히)를 네트워크 호출 전에 확인하고, 어긋나면 거절합니다.
- 값이 깨져 파싱에 실패해도 오류 문구에 그 값이 들어가지 않습니다. `JSON.parse`는 실패한 입력을 오류 문구에 넣는데, 인라인 값에서 그 입력은 곧 비밀값 자체입니다 — `src/lib/youtube/auth.test.ts`가 이 점을 따로 검증합니다.

## 환경변수

실제 값은 이 문서에도, 대화에도, Git에도 남기지 않습니다. `.env.local`(또는 배포 환경의 환경변수)에만 넣고 서버에서만 읽습니다 (`NEXT_PUBLIC_` 접두사가 없으므로 브라우저에 노출되지 않습니다).

| 이름 | 용도 |
|---|---|
| `YOUTUBE_OAUTH_CLIENT_JSON` | 18장 OAuth Desktop client JSON의 **내용** (JSON 또는 base64). 배포용 |
| `YOUTUBE_OAUTH_CLIENT_JSON_PATH` | 같은 client JSON의 **파일 경로** (읽기 전용 재사용). 로컬용. 위와 동시에 설정하면 거절 |
| `YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON` | 댓글용(`youtube.force-ssl`) Token JSON의 **내용** (JSON 또는 base64). 배포용 |
| `YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH` | 같은 Token JSON의 **파일 경로**. `npm run setup:youtube-comment-read`가 저장한 이 장 전용 Token 경로를 넣습니다 — 18장 Token은 이 범위를 부여하지 않으므로 재사용할 수 없습니다. 위와 동시에 설정하면 거절 |
| `GEMINI_API_KEY` | Google AI Studio에서 발급한 Gemini 키 |
| `GEMINI_MODEL` | 이 프로젝트가 사용할 Gemini 모델 이름 |
| `SUPABASE_URL` | 20장 상태 저장소(Supabase) 프로젝트 주소 |
| `SUPABASE_SERVICE_ROLE_KEY` | 20장 상태 저장소의 service_role 키. 요청 헤더로만 보내고 URL·SQL·로그에는 넣지 않습니다 |
| `AUTO_REPLY_SCHEDULER_SECRET` | 예약 실행(`/api/auto-reply/run`)을 부를 때 `Authorization: Bearer`로 보내는 열쇠. 없으면 그 경로는 항상 거절합니다 |
| `AUTO_REPLY_OPERATOR_SECRET` | 사람이 쓰는 여섯 경로(target/prepare/enable/send/stop/status)의 열쇠. 내 컴퓨터에서는 비워 둘 수 있지만, 배포한 서버에서는 없으면 여섯 경로 모두 닫힙니다 |
| `AUTO_REPLY_APPROVAL_SECRET` | 승인 Token 서명에 쓰는 열쇠. 비우면 운영자 열쇠를 쓰고, 그것도 없으면 프로세스마다 임의 값을 만듭니다(재시작하면 발급된 승인이 모두 무효 — 안전한 쪽으로 실패) |

## 명령

```bash
npm run lint                 # ESLint
npm run typecheck            # tsc --noEmit
npm test                     # vitest — 외부 API 호출 없이 fixture로 검증
npm run build                 # 프로덕션 빌드 (배포하지는 않습니다)
npm audit --audit-level=high  # 의존성 취약점 확인
npm run setup:youtube-comment-read -- <client_secret.json 경로>
# 항상 .secrets/youtube-comment-read-oauth.json에만 저장합니다.
```

## 20장 — 일곱 경로와 처리 규칙

| 경로 | 누가 부르나 | 하는 일 |
|---|---|---|
| `POST /api/auto-reply/target` | 사람 | 대상·기준 시각을 저장합니다. 전송 0건, 새 대상으로 바꾸면 예약 실행은 꺼집니다 |
| `POST /api/auto-reply/prepare` | 사람 | 답글 1개를 준비해 **문장 그대로** 보여 주고 서명(`approvalToken`)합니다. **전송은 0건**이고 예약 실행을 켜지 않습니다. 이미 준비된 대상의 댓글만 받으며 대상·기준 시각을 변경하지 않습니다 |
| `POST /api/auto-reply/send` | 사람 | `approvalToken`이 담은 그 문장으로 답글 1개를 보냅니다. 본문에 답글 문구를 넣는 칸은 없습니다. 예약 실행이 꺼져 있어도 됩니다 |
| `POST /api/auto-reply/enable` | 사람 | 이미 준비된 영상 1개의 예약 실행을 켭니다. 결과 미확인 중단은 해제하지 않습니다. 전송은 0건이며, 기준 시각은 처음 값이 유지됩니다 |
| `POST /api/auto-reply/run` | 예약 실행(10분마다) | 한 페이지(20개)를 분류해 조건에 맞는 1개에만 보냅니다. 커서를 저장하고, 30일 지난 기록을 지웁니다 |
| `POST /api/auto-reply/stop` | 사람 | 예약 실행을 끕니다. 이후 예약 실행은 전송 0건입니다(사람 승인 전송은 계속 가능) |
| `GET /api/auto-reply/status` | 사람 | 켜짐/꺼짐, 승인한 영상, 기준 시각, 오늘 전송 통계, 최근 기록(id·상태·시각만) |

지켜지는 처리 규칙:

- 한 번 실행에 분류 **최대 20개**. 전송 개수 상한 없이 통과한 댓글을 순서대로 처리합니다. 수동 승인은 선택한 답글 하나만 보냅니다.
- 대상은 기준 시각 **이후**이고 **최근 7일 안**인 새 최상위 댓글뿐입니다. 기준 시각은 처음 대상을 준비할 때 한 번 정해지고, 껐다 켜도 이동하지 않습니다.
- 자동 전송 대상은 19장의 두 검사(AI 문맥 검사·프로그램 검사)를 통과한 **일반 반응**과 **추가 요청**뿐입니다. 질문·사실 정정·광고, 그리고 판단이 애매한 것은 자동으로 보내지 않습니다.
- 같은 댓글에는 두 번 보내지 않습니다. 기록이 남는 순간 다시 대상이 되지 않습니다.
- 같은 댓글의 중복 전송은 데이터베이스의 고유 기록으로 막습니다.
- 전송 결과를 확인하지 못하면(`RESULT_UNKNOWN`) 기록을 보존하고 자동답글을 끕니다. 다시 보내지 않고 사람을 기다립니다. 이 멈춤은 사람의 승인보다 우선합니다.
- 결과가 불확실한 기록은 그 댓글의 답글 목록을 `comments.list`로 **끝까지** 읽어 확인합니다. 마지막 쪽까지 못 읽었으면 "답글 없음"으로 단정하지 않습니다. 잠금 시간이 지났다는 이유만으로 다시 보내는 일은 없습니다.
- 저장하는 것은 댓글 id·영상 id·상태·짧은 이유 라벨·시각·답글 id뿐이고, **30일이 지나면 지워집니다**(단, 그 삭제는 `/api/auto-reply/run`이 불릴 때 일어납니다 — 위 C 절의 한계를 보세요). 댓글 원문·작성자·답글 문구는 저장하지 않습니다.

## 로컬에서 확인하기 (실제 전송 없이)

```bash
npm test
```

전송·동시 실행·실패 상황은 모두 Mock과 Fake로 검증합니다. 실제 YouTube·Supabase·Gemini를 부르는 테스트는 없습니다.

브라우저에서 직접 볼 때는 `npm run dev`로 1~3단계를 먼저 확인하고, 5단계에서 **상태 확인**만 눌러 보세요. `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`가 비어 있으면 "서버 설정이 아직 없습니다"라고 답하고 아무 일도 하지 않습니다. 4단계에서 준비한 문장을 승인하는 순간부터는 실제 동작입니다 — 실제 YouTube에 답글이 올라갑니다. 올라간 답글은 이 프로그램이 지울 수 없습니다.

## 배포할 때 넣는 값 (아직 하지 않아도 됩니다)

1. Supabase에서 `supabase/migrations/20260914000000_ch20_auto_reply.sql`을 한 번 실행합니다. 테이블 4개와 함수만 만들고, 일정은 만들지 않습니다. 이 파일은 함수 21개의 실행 권한을 `public`·`anon`·`authenticated`에서 회수하고 `service_role`에만 다시 부여합니다 — 브라우저에 노출되는 anon 키로는 이 함수를 부를 수 없습니다. SQL 편집기에서 일부만 골라 실행하지 말고 파일 전체를 한 번에 실행하세요. 권한 줄을 빼먹으면 함수가 열린 상태로 남습니다.
2. 배포한 서버의 환경변수에 위 표의 이름들을 넣습니다. `.env.local`은 배포되지 않으므로, 자격증명은 `..._JSON` 이름으로 넣습니다.
3. 10분마다 실행할 일정은 [`supabase/cron/README.md`](supabase/cron/README.md)의 절차를 사람이 직접 진행합니다. 열쇠는 Supabase Vault에 넣고 `Authorization` 헤더로만 보냅니다 — URL·SQL·로그에는 넣지 않습니다.
4. **일정 등록 성공은 전송 성공이 아닙니다.** 등록됐는지(`cron.job`), 요청이 닿았는지(`net._http_response`), 서버가 무엇을 했는지(응답 본문의 `outcome`) 세 층을 따로 확인하세요.

## 멈추기와 되살리기

- 급할 때: `POST /api/auto-reply/stop`(또는 5단계의 **자동답글 끄기**)으로 스위치를 끄고, `select cron.unschedule('ch20-auto-reply-run');`으로 일정을 지웁니다. 둘은 다른 일이라 급하면 둘 다 합니다.
- `halted_result_unknown`이 나오면 자동답글은 이미 꺼져 있습니다. YouTube에서 실제 결과를 사람이 확인해야 합니다. `stop`·`enable`은 이 중단을 해제하지 않습니다. 자동 복구 기능은 없으며 확인 전에는 잠금를 되돌리거나 재전송하지 않습니다. **기준 시각은 새로 잡히지 않습니다** — 멈춰 있는 동안 올라온 댓글을 건너뛰지 않기 위해서입니다. 문제가 된 그 댓글에 다시 보내지 않는 근거는 새 기준 시각이 아니라 **이미 남아 있는 기록**입니다.
- 이미 올라간 답글은 사람이 YouTube에서 지웁니다. 이 프로젝트에는 댓글을 지우는 경로가 없습니다.

## 안전 경계

- 서버 코드만 인증정보를 읽습니다 — client JSON과 댓글용 Token은 파일이든 환경변수 값이든 서버에서만 읽고, 브라우저·로그·Git에는 값이 남지 않습니다. 오류 문구에도 값이 들어가지 않습니다 (`src/lib/youtube/auth.test.ts`).
- 댓글 원문·작성자 정보는 DB나 파일에 저장하지 않고, 응답에는 `Cache-Control: no-store`를 붙입니다.
- 댓글 속에 적힌 지시·링크·역할 변경 요청은 자료로만 다루고 따르지 않습니다.
- 개인정보로 보이는 댓글은 Gemini로 보내지 않고 사람 확인으로 남깁니다.
- Gemini 응답은 엄격한 런타임 스키마로 검사합니다 — `passed`는 정확히 boolean `true`일 때만 통과이고, 문자열 `"false"`나 숫자·배열 같은 잘못된 형식은 모두 실패로 처리합니다(`src/lib/gemini/schema.ts`).
- `/api/comments`는 요청마다 채널 소유와 공개 범위(public/unlisted만)를 다시 확인하고, 비공개이거나 공개 범위를 확인할 수 없는 영상은 `commentThreads.list`를 부르기 전에 차단합니다.
- `/api/review`는 한 번에 1~20개 댓글만 받고, 본문·ID 길이와 날짜 형식, 중복 ID를 서버에서 검사합니다.
- 자동답글 후보의 초안은 AI 문맥 검사와 프로그램 검사를 모두 통과해야만 후보로 유지됩니다. 사람이 승인한 문장도 전송 직전에 그 두 검사를 다시 통과해야 합니다.
- 승인 Token은 영상 id·댓글 id·댓글 원문의 해시·기준 시각·보낼 문장·만료 시각에 서명한 값입니다. 원문은 담지 않고(해시만), 어디에도 저장되지 않으며, 10분이 지나면 만료됩니다.
- 쓰기는 `comments.insert` 한 개뿐이고, `src/lib/youtube/reply-client.ts` 한 파일에서만 만들어집니다. 댓글 수정·삭제·차단·스팸 신고, 영상 변경 경로는 어디에도 없습니다 (`src/app/bounded-write-surface.test.ts`).
- 19장의 미리보기 세 경로(`/api/video`, `/api/comments`, `/api/review`)는 `NODE_ENV=production`에서 **404**로 닫힙니다. 화면(`/`)은 닫히지 않고 **200**으로 응답하지만 미리보기 대신 안내 화면만 보여 줍니다 — 배포한 서버가 남의 댓글 원문을 보여 주지 않습니다 (`src/app/production-preview-blocked.test.ts`).
- 예약 실행 경로는 열쇠가 설정되지 않았으면 **항상** 거절합니다. 열쇠는 `Authorization` 헤더에서만 읽고, 쿼리 문자열로 보낸 열쇠는 인정하지 않습니다.
- 실패 응답은 고정된 한국어 문구뿐입니다. 저장소 주소·키·원본 오류 문구는 브라우저로 나가지 않습니다.
- 상태 저장소에는 댓글 원문·작성자·답글 문구를 담을 열(column)이 아예 없고, 남는 id·상태·시각도 30일 뒤 삭제됩니다 (`src/lib/autoreply/no-comment-text-stored.test.ts`).
- 상태 저장소는 서버 역할(`service_role`)만 부를 수 있습니다. 표 4개는 RLS가 켜져 있고 정책이 하나도 없으며, 함수 21개는 전부 실행 권한을 회수한 뒤 `service_role`에만 다시 부여합니다. 그 키를 읽는 파일은 어댑터 `src/lib/autoreply/supabase-store.ts` 하나뿐이고, 키는 헤더로만 갑니다 — URL·SQL·로그에는 넣지 않습니다 (`src/lib/autoreply/store-permissions.test.ts`, `src/lib/autoreply/supabase-store.test.ts`).
- 자동답글의 기본값이자 마지막 상태는 **꺼짐**입니다. 켜는 것도 끄는 것도 사람이 합니다.

## 공식 확인 문서

아래는 공식 문서 링크입니다. 요금·할당량·데이터 처리 조건의 실제 수치는 이 저장소에서 단정하지 않으니, 실제 값은 아래 링크에서 직접 확인하세요.

- YouTube Data API — Installed app(Desktop) OAuth: https://developers.google.com/identity/protocols/oauth2/native-app
- YouTube Data API — 인증 범위: https://developers.google.com/youtube/v3/guides/auth/installed-apps
- YouTube Data API — 할당량: https://developers.google.com/youtube/v3/getting-started#quota
- Gemini API — API 키 발급: https://ai.google.dev/gemini-api/docs/api-key
- Gemini API — 모델 목록: https://ai.google.dev/gemini-api/docs/models
- Gemini API — SDK(`@google/genai`): https://github.com/googleapis/js-genai
- Gemini API — 요금: https://ai.google.dev/pricing
- Google AI 서비스 약관·데이터 사용: https://ai.google.dev/gemini-api/terms

## 검증 상태

이 저장소가 로컬 fixture로 실제 확인한 것과, 실계정이 있어야만 확인되는 항목은 [`verification/README.md`](verification/README.md)에 구분되어 있습니다.

## API 참고 — 첫 브라우저 실습 뒤에 읽기

대상 준비는 `POST /api/auto-reply/target`에 `videoId`만 전달합니다. 그 응답의 기준 시각 이후에 새 시험 댓글을 작성하세요. `prepare`는 이미 준비된 대상의 댓글만 받습니다.

**1) 준비 — 서버가 보낼 문장을 만들어 보여 주고 서명합니다. 전송은 0건입니다.**

```bash
curl -s -X POST http://localhost:3000/api/auto-reply/prepare \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $AUTO_REPLY_OPERATOR_SECRET" \
  -d '{"videoId":"<영상 id>","topLevelCommentId":"<댓글 id>"}'
```

응답에 `draft`(화면에 그대로 보여 줄 문장), `approvalToken`(그 문장에 대한 서명), `sentCount: 0`가 들어 있습니다.

**2) 사람이 그 문장을 읽습니다.** 화면에 보이지 않은 문장은 승인할 수 없습니다.

**3) 전송 — 받은 `approvalToken`을 그대로 돌려보냅니다.**

```bash
curl -s -X POST http://localhost:3000/api/auto-reply/send \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $AUTO_REPLY_OPERATOR_SECRET" \
  -d '{"videoId":"<영상 id>","topLevelCommentId":"<댓글 id>","approvalToken":"<위에서 받은 값>"}'
```

본문에 답글 문구를 넣는 칸은 없습니다. 문구는 Token의 서명된 내용에서 나오므로, 올라가는 문장은 사람이 읽은 문장과 **글자 그대로 같습니다.**


서버는 화면에 보여 준 문장·댓글·기준 시각을 서명한 승인 정보를 발급합니다. 승인은 10분 뒤 만료되며 댓글이나 대상이 달라지면 거부합니다. 전송 시점에 문장을 다시 생성하지 않습니다. 승인 정보는 메모리에만 두고 로그에 남기지 않습니다.

전송 lease의 120초는 진단 기준일 뿐입니다. 만료돼도 다른 전송이 잠금을 인수하지 못합니다. POST timeout·HTTP 408·통신 단절은 결과 미확인으로 처리하며, DB 확정 기록을 저장하지 못해도 잠금을 자동 해제하지 않습니다.

상태 API와 5단계의 최근 실행은 예약/수동, 시작·완료 시각과 전송 수를 보여 줍니다. 펼쳐보기에는 run id·outcome·후보·사람 확인·실패·전송 수가 있습니다. 완료 시각이 없으면 실행 중이거나 중단된 것으로 보고, 0건 완료와 구분합니다. 원문·작성자·비밀값은 포함하지 않습니다.


### 호출과 반복 게시의 한계

예약 실행은 자기 채널 댓글과 작성자를 확인할 수 없는 댓글을 제외합니다. 자신의 시험 댓글은 화면의 문장을 승인한 수동 시험에서만 사용할 수 있습니다. 전송 직전에 해당 댓글의 전체 답글을 확인하며, 내 답글이 있거나 조회를 끝내지 못하면 사람 확인으로 남깁니다. 최근 1시간의 성공 기록에 연결된 실제 답글과 같은 문장도 보내지 않습니다. 비교용 원문은 요청 메모리에서만 사용합니다.

전송과 DB 기록은 개수 대신 실행 시간으로 제한합니다. 한 요청의 나머지 외부 호출 상한은 YouTube 조회 100회(답글 페이지 포함), Gemini 60회, OAuth 갱신 4회입니다. 개별 요청은 30초 제한이며 자동 재시도하지 않습니다. 예약 중 인증·한도 오류가 확인되면 예약 전송을 끄며, 설정을 고친 뒤 사람이 다시 켭니다. 분류를 시작한 뒤 60초가 지나면 새 Gemini 호출을 시작하지 않고 전송을 보류합니다. 서버 업무는 150초 예산 안에서 실행하고, 종료·전송 결과 기록에는 최대 30초의 별도 여유를 둡니다. 저장소까지 실패한 실행은 완료 기록이 없을 수 있으므로 성공으로 해석하지 않습니다.
