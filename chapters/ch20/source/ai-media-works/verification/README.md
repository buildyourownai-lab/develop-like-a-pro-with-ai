# 검증 상태 — 19·20장. 댓글 읽기·분류·초안 미리보기와 답글 보내기

이 문서는 로컬 fixture로 실제 확인한 것(IMPLEMENTED)과, 실계정·실제 Gemini 응답·실제 배포가 있어야만 확인되는 것(UNVERIFIED)을 구분합니다.

## 이 프로젝트가 하는 일 (기능 범위)

- 내 채널이 소유한 시험 영상 한 편의 최상위 댓글을 `commentThreads.list`로 최신순 최대 20개 읽습니다.
- 댓글을 다섯 종류로 분류하고, 서버가 고정한 표에 따라 세 처리 수준(자동답글 후보 / 사람 확인 / 답하지 않음)으로 나눕니다.
- 자동답글 후보에만 짧은 한국어 초안을 만들고, 프로그램 검사와 별도의 AI 문맥 검사를 모두 통과해야 후보로 유지합니다.
- 1~3단계 결과는 브라우저 화면에서만 보이고, `NODE_ENV=production`에서는 그 세 경로(`/api/video`·`/api/comments`·`/api/review`)가 404로 닫힙니다. 화면(`/`)은 404가 아니라 200으로 응답하며, 미리보기 대신 안내 문구만 보여 줍니다.
- 20장에서 쓰기 호출 한 개(`comments.insert`)가 생깁니다 — 사람이 승인한 1개, 또는 예약 실행이 고른 댓글. 회당·하루 전송 개수 상한은 없고, 기본값은 꺼짐입니다.
- 사람의 승인은 두 요청으로 나뉩니다: `prepare`가 보낼 문장을 만들어 그대로 보여 주고 서명하며(전송 0건), `send`는 그 서명(`approvalToken`)이 담은 문장만 보냅니다. 승인은 10분 뒤 만료됩니다.

## 재현 명령과 측정 상태

### 19장 시점 (commit `3ca0f73`)에서 측정된 값

아래는 `node_modules`와 `.next`를 지우고 `npm ci`로 처음부터 다시 설치한 뒤 실행해 얻은 결과입니다. **20장 구현이 더해진 현재 작업 트리의 값이 아닙니다.**

```
$ npm test                       → exit 0 (Test Files 27 passed, Tests 331 passed)
$ npm run lint                   → exit 0 (eslint .)
$ npm run typecheck              → exit 0 (tsc --noEmit)
$ npm run build                  → exit 0 (Next.js 16.3.5, Turbopack; routes: /, /api/video, /api/comments, /api/review)
$ npm audit --audit-level=high   → found 0 vulnerabilities
$ git diff --check               → 출력 없음 (공백 오류 없음)
```

### 20장 이전 후보 측정 — 역사 기록

2026-09-14에 이 분리 작업공간에서 처음부터 설치하고 전체 로컬 게이트를 실행했습니다. 외부 YouTube·Gemini·Supabase·Vercel을 호출한 결과는 아니며 아래 UNVERIFIED 항목과 구분합니다.

```
$ npm ci                        → exit 0 (419 packages, audit 0)
$ npm test                      → exit 0 (Test Files 38 passed, Tests 558 passed)
$ npm run lint                  → exit 0 (eslint .)
$ npm run typecheck             → exit 0 (tsc --noEmit)
$ npm run build                 → exit 0 (Next.js 16.3.5; app route 11개 — 화면 1개, not-found, API 9개)
$ npm audit --audit-level=high  → found 0 vulnerabilities
$ git diff --check              → 출력 없음
```

이전 후보 측정: 2026-09-14, 아래 추가 결함 수정 전 판본. 현재 후보의 검사 결과로 사용하지 않습니다. `npm ci`는 이 트리를 처음 준비할 때 실행한 값이고, 나머지 여섯 줄은 그 뒤 문서·설정 변경을 반영해 다시 실행한 결과입니다.

## Mock 범위 (외부 API 호출 없이 검증한 것)

- **Gemini 응답 스키마 fail-closed**: `src/lib/gemini/schema.ts`가 `category`/`mixedSignals`/`draft`/`passed`/`reason`을 엄격하게 검사합니다. `passed`는 정확히 boolean `true`일 때만 통과이고, malformed JSON·누락·null·배열·숫자·문자열 `"false"`·정해지지 않은 category는 모두 던져서 실패로 처리됩니다(`src/lib/gemini/schema.test.ts`, `src/lib/gemini/real-client.test.ts`).
- **한 영상·공개 범위·최대 20개 서버 강제**: `/api/comments`는 채널 소유와 공개 범위(public/unlisted만)를 요청마다 다시 확인하고, 그 외 상태는 `commentThreads.list` 호출 전에 차단합니다. `/api/review`는 1~20개만 허용하고 중복 ID·과도한 길이·잘못된 날짜를 400으로 거부하며, 응답 형식이 어긋나면 500 대신 명시적 안전 오류를 반환합니다(`src/app/api/comments/route.test.ts`, `src/app/api/review/route.test.ts`, `src/lib/comments/request-validation.test.ts`, `src/lib/youtube/schema.ts`).
- **읽기 클라이언트의 쓰기 요청 0건**: `src/lib/youtube/real-client.test.ts`가 모든 호출을 기록해 OAuth 토큰 갱신(POST, `oauth2.googleapis.com`) 외 모든 `googleapis.com` 호출이 GET임을 단언하고, 그 클라이언트 인터페이스에 읽기 메서드 세 개만 있음을 단언합니다.
- **쓰기 경계는 한 파일의 한 호출**: `src/app/bounded-write-surface.test.ts`가 소스 전체를 정적으로 스캔해 (1) `authedPost`를 쓰는 파일이 `src/lib/youtube/reply-client.ts` 하나뿐이고, (2) 그 본문이 `parentId`와 `textOriginal`만 담으며(moderationStatus·authorChannelId 없음), (3) `comments.update/delete/setModerationStatus/markAsSpam`·`commentThreads.insert`·`videos.update/delete/insert/rate` 같은 다른 쓰기가 어디에도 없고, (4) `src/app/api`의 경로가 `auto-reply`(enable/prepare/run/send/status/stop/target)와 19장 세 경로뿐이며, (5) 제외한 기능(Chat·Worker·큐·대표실·Analytics·회원가입)의 흔적이 없고, (6) `SUPABASE_` 환경변수를 읽는 파일이 어댑터(`src/lib/autoreply/supabase-store.ts`) 하나뿐이고, 그 어댑터를 만드는 곳도 배선 파일(`src/lib/autoreply/real-deps.ts`) 하나뿐임을 확인합니다.
- **분류·초안·검사 파이프라인**: 단순 응원, 후속 요청, 질문, 사실 지적, 광고, 혼합 신호, 프롬프트 인젝션, 개인정보, 빈 문장, 장문에 대한 fixture 시험이 통과합니다(`src/lib/comments/pipeline.test.ts`).
- **로컬 OAuth 설정 스크립트의 실패 경로**: 취소, state 불일치, 콜백 오류, 범위 누락, `refresh_token` 누락, 포트 충돌을 Mock HTTP·Mock 콜백 요청으로 검증합니다(`scripts/tests/`).
- **댓글 읽기용 Token 파일·Token 갱신 응답의 엄격한 검증 (2026-09-14 정정)**: 실제 계정으로 `commentThreads.list`를 호출해 `youtube.readonly` Token이 HTTP 403 `insufficientPermissions`를 반환하는 것을 확인한 뒤, 공식 Discovery 문서를 기준으로 허용 범위를 다시 정의했습니다. `loadRefreshToken`은 파일이 객체가 아니거나, `refresh_token`이 문자열이 아니거나, 부여된 범위가 정확히 `https://www.googleapis.com/auth/youtube.force-ssl` 단독이 아니면 API 호출 전에 fail-closed합니다 — `youtube.readonly`와 18장 상태변경 Token의 `.../auth/youtube`는 더 이상 허용 목록에 없으며(둘 다 공식 Discovery 문서에서 `commentThreads.list`의 허용 범위로 나열되지 않음), `youtube.upload`와 마찬가지로 네트워크 요청(토큰 갱신 POST) 전에 거부됩니다. 범위는 단일 공백구분 `scope` 문자열과 Google `Credentials.to_json`이 만드는 `scopes` 배열 두 형태 모두 안전하게 읽되, 배열에 문자열이 아닌 값이 있으면 malformed로 거부합니다. 범위 필드가 전혀 없거나 알려지지 않은 범위만 있는 경우도 모두 네트워크 요청 전에 거부되며, 각 테스트가 `fetchMock`이 호출되지 않았음을 단언합니다. OAuth Token 갱신 응답도 `access_token`이 빈 문자열/누락이거나 `expires_in`이 숫자가 아니거나(문자열 `"3600"` 포함) 0 이하이면 `Authorization: Bearer undefined`를 보내지 않고 즉시 실패합니다(`src/lib/youtube/real-client.test.ts`). Token 파일을 자동으로 찾거나 경로·내용을 출력하는 코드는 없고, 이 로더는 파일을 쓰거나 갱신하지 않습니다 — access token 캐시는 메모리에만 있고(`cachedToken`), `YoutubeClient`에는 읽기 메서드 세 개만 있습니다.
- **로컬 OAuth 설정의 레이스·응답·경로 안전성**: 콜백 서버가 실제로 listening 상태가 된 뒤(`ready` 계약)에만 동의 URL을 출력하고, 포트 충돌 시 `ready`가 즉시 실패로 settle되어 멈추지 않습니다. 콜백 페이지는 `text/plain`과 고정 문구만 반환해 Google의 `error` 파라미터를 그대로 반사하지 않습니다. `loadOAuthClient`는 Desktop(`installed`) 형식만 허용하고 `web`·flat 형식을 거부합니다. Token 저장 경로는 프로젝트 안의 고정된 한 경로로 제한되고(CLI에 경로를 바꾸는 인자가 없음), client JSON과 같은 경로나 프로젝트 밖 경로는 거부합니다. 저장은 임시 파일 작성 후 원자적 rename으로 이뤄지고(0600, 실패 시 임시 파일 잔류 없음) 검증되지 않은 Token으로 기존 파일을 먼저 건드리지 않습니다(`scripts/tests/callback-server.test.mjs`, `scripts/tests/client-json.test.mjs`, `scripts/tests/token-output-path.test.mjs`, `scripts/tests/setup-youtube-comment-read-oauth.test.mjs`, `scripts/tests/secure-store.test.mjs`).
- **영상·채널 조회 실패의 안전한 분류**: `/api/video`의 영상·채널 조회 실패는 `status:"ok"` 카드 안의 원문 영어 오류가 아니라, 닫힌 집합의 `reason`과 한국어 안내가 담긴 `status:"error"`로 돌아옵니다. `/api/comments`의 소유·공개 범위 확인 실패도 raw `detail` 필드 없이 같은 방식으로 분류됩니다. 주소가 잘못됐거나 영상이 지워진 경우(`videos.list`의 빈 `items`, `commentThreads.list`의 404)와 연결된 계정에 채널이 없는 경우(`channels.list`의 빈 `items`)는 `video_not_found`/`channel_not_found`로 따로 분류해 404로 돌려주므로, 응답 형식 오류나 통신 실패와 섞이지 않습니다(`src/lib/youtube/error-classification.test.ts`, `src/app/api/video/route.test.ts`, `src/app/api/comments/route.test.ts`).
- **읽지 못한 항목의 공개**: `commentThreads.list`가 돌려준 항목 중 형태를 읽을 수 없는 것이 섞여 있으면 나머지 댓글은 그대로 보여주고 제외한 개수(`skippedCount`)를 화면에 함께 표시합니다. 목록이 조용히 짧아지지 않고, 모든 항목을 읽지 못한 경우는 빈 목록이 아니라 오류로 처리됩니다. 다른 시청자의 댓글에는 `snippet.textOriginal`이 오지 않으므로(공식 Comments 자료, 2026-09-14 확인) 화면에 쓰는 본문은 `textFormat=plainText`로 받은 `textDisplay`입니다(`src/lib/youtube/schema.ts`, `src/lib/youtube/real-client.test.ts`, `src/app/api/comments/route.test.ts`).
- **설정 오류의 타입 기반(닫힌) 분류**: 환경변수 누락, client/token 파일을 읽거나 파싱할 수 없는 경우, 부여된 범위가 부족한 경우는 각각 `YoutubeConfigMissingError`/`YoutubeCredentialFileError`/`YoutubeScopeInsufficientError` 타입으로 던져지고, 분류기는 `error.message` 문자열이 아니라 `instanceof`로 판별합니다 — 그 메시지가 로컬 파일 경로를 담고 있어도 브라우저로 가는 고정된 한국어 안내문에는 그 경로가 전혀 섞이지 않습니다. 리더 UI는 이 세 경우 모두에 실행 가능한 다음 행동(18장 Token은 이 범위를 부여하지 않으므로 재사용할 수 없다는 안내, 정확한 `npm run setup:youtube-comment-read -- <client_secret*.json 경로>` 명령, 설정된 두 경로와 README 확인)을 보여줍니다(`src/lib/youtube/error-classification.test.ts`, `src/lib/youtube/real-client.test.ts`, `src/app/api/video/route.test.ts`, `src/app/api/comments/route.test.ts`, `src/app/home-client-wording.test.ts`).
- **Gemini 실패의 닫힌 분류와 fail-closed 다운그레이드**: `src/lib/gemini/error-classification.ts`가 `config_missing`/`auth_error`/`quota_exceeded`/`model_or_request_error`/`network_error`/`invalid_response`/`service_error` 일곱 개로만 분류합니다. `GeminiConfigMissingError`(타입 기반)와 `GeminiSchemaError`는 `instanceof`로, `@google/genai`의 `ApiError.status`(401/403→auth_error, 429→quota_exceeded, 400/404→model_or_request_error)와 `TypeError`/SDK 내부 `HTTPClientError` 계열의 고정된 `name`(→network_error)은 값으로 판별하며, 그 외는 모두 `service_error`로 fail-closed합니다. 어떤 사유든 `error.message`·경로·키·호스트 문자열은 분류기와 고정 한국어 안내문 어디에도 섞이지 않습니다(raw 문자열 비노출을 직접 단언하는 테스트 포함, `src/lib/gemini/error-classification.test.ts`, `src/lib/gemini/real-client.test.ts`). 분류/초안/AI 문맥검사 중 어느 Gemini 호출이 실패해도 해당 댓글은 예외 없이 `HUMAN_REVIEW`로 남고 자동답글 후보로 절대 올라가지 않으며, `CommentReviewItem.geminiIssue`에 실패 단계(`classification`/`draft`/`context_check`)와 사유가 남습니다 — 빈 댓글·개인정보 같은 로컬 안전장치나 프로그램 검사 단독 실패는 Gemini 장애로 기록되지 않습니다(`src/lib/comments/pipeline.test.ts`). `/api/review`는 `GEMINI_API_KEY`/`GEMINI_MODEL` 누락을 호출 전에 안전한 `status:"error"`(`reason:"config_missing"`)로 즉시 차단하고, 배치 중 하나라도 `geminiIssue`가 있으면 `status:"ok"`가 아니라 `status:"partial"`로 반환해 실제 Gemini 전체 성공과 혼동될 수 없게 합니다 — 이 상태에서도 안전하게 다운그레이드된 항목은 그대로 반환됩니다(`src/app/api/review/route.test.ts`). 리더 UI는 `status:"partial"`일 때 "실제 Gemini 성공이 아닙니다"라는 경고와, 배치에 나타난 사유마다 정확히 하나의 실행 가능한 다음 행동(키/모델 설정 후 재시작, 키 권한 확인, 사용량 확인, 지원 모델·요청 확인, 인터넷 확인, 잠시 후 재시도)을 보여주며 원문 오류 텍스트는 노출하지 않습니다(`src/app/home-client-wording.test.ts`).

## 20장 Mock 범위 (위 로컬 게이트에서 확인)

- **첫 활성화는 0건 전송**: `target`은 채널·영상·기준 시각만 저장하고, 이미 댓글이 몇 개든 분류도 전송도 하지 않습니다. 다시 켜도 기준 시각은 처음 값이 유지되므로(멈춰 있던 동안의 댓글을 건너뛰지 않기 위해) 그 댓글에 다시 보내지 않는 근거는 새 기준 시각이 아니라 남아 있는 기록입니다(`src/app/api/auto-reply/routes.test.ts`, `src/lib/autoreply/runner.test.ts`).
- **같은 댓글 재실행 0건 추가**: 기록이 있는 댓글은 `already_recorded`로 끝나고 두 번째 `comments.insert`가 없습니다(`src/lib/autoreply/runner.test.ts`, `src/lib/autoreply/concurrency.test.ts`).
- **전송 상한 제거**: 하루 다섯 건을 넘겨도 처리하며, 한 예약 실행에서 서로 다른 일곱 답글을 보낸 뒤 재실행 전송 0건을 확인합니다.
- **응답 끊김 → `RESULT_UNKNOWN` → 기록을 보존하고 자동답글 정지**: 상태와 스위치가 한 번에 바뀌고, 예약 실행은 그래도 HTTP 200으로 답해 일정이 재시도하지 못하게 합니다(`src/lib/autoreply/runner.test.ts`, `src/app/api/auto-reply/routes.test.ts`).
- **답글 확인은 `comments.list` 전체 쪽 넘김**: 마지막 쪽까지 읽지 못하면 `page_limit_reached`로 "답글 없음"이라 단정하지 않고, 잠금 시간 만료만으로는 재전송하지 않습니다(`src/lib/youtube/reply-client.test.ts`, `src/lib/autoreply/runner.test.ts`).
- **조회 범위와 기록**: 20개 조회·최근 7일 창·기록 시각을 확인합니다. 날짜가 바뀌었다는 이유로 전송을 차단하지 않습니다.
- **만료된 OAuth**: 전송 전 인증 실패는 "확실히 보내지 않음"으로 분류되어 자리를 되돌립니다(`src/lib/youtube/reply-client.test.ts`, `src/lib/autoreply/runner.test.ts`).
- **배포 서버에서 19장 미리보기 차단**: `NODE_ENV=production`에서 `/api/video`·`/api/comments`·`/api/review`가 404로 닫히고 YouTube·Gemini를 한 번도 부르지 않습니다. 화면(`/`)은 200으로 응답하되 미리보기 대신 고정된 안내 문구만 렌더링합니다 — 화면 자체가 404가 되는 것은 아닙니다(`src/app/production-preview-blocked.test.ts`, `src/app/page.tsx`).
- **파일 경로 없이도 되는 자격증명 설정**: client JSON과 댓글용 Token을 파일 경로 대신 환경변수 값(JSON 또는 base64, URL-safe·줄바꿈 포함)으로 줄 수 있고, 검사는 파일과 똑같이 엄격합니다(`installed` 형식, `refresh_token`, `youtube.force-ssl` 단독 범위 — 모두 네트워크 호출 전). 한 자격증명에 값과 경로를 동시에 설정하면 어느 쪽도 읽지 않고 `config_missing`으로 거절하며, 오류 문구에는 충돌한 두 이름만 남습니다. 깨진 값이 파싱에 실패해도 그 값(=비밀값)이 오류 문구에 들어가지 않는 것을 직접 단언합니다(`src/lib/youtube/auth.test.ts`).
- **사람 승인 2단계 전송**: `target`은 대상과 기준 시각을 먼저 저장하며, `prepare`는 준비된 대상의 문장을 보여 주고 서명합니다. 두 요청 모두 전송은 0건이며 예약 실행을 켜지 않습니다. `send`는 서명된 문장만 보내고, 서명 위조(`bad_signature`)·만료(`expired`)·다른 댓글(`comment_mismatch`)·수정된 댓글(`comment_changed`)·승인된 문장이 검사를 다시 통과하지 못한 경우(`reply_not_verified`)를 각각의 `approvalIssue`로 거절합니다(`src/lib/autoreply/runner.test.ts`, `src/app/api/auto-reply/routes.test.ts`).
- **예약 실행 인증**: 열쇠가 없으면 항상 503, 틀리면 401, 쿼리 문자열로 보낸 열쇠는 인정하지 않고, 실패 문구는 어떤 경우든 같습니다(`src/lib/autoreply/request-auth.test.ts`, `src/app/api/auto-reply/routes.test.ts`).
- **정지 후 0건**: 일반 `stop` 이후 예약 실행만 멈추며, 새로 승인한 수동 전송은 가능합니다. `RESULT_UNKNOWN` 중단은 둘 다 차단하고 `stop`·`enable`으로 지워지지 않습니다(`src/app/api/auto-reply/routes.test.ts`).
- **열쇠가 새지 않음**: service_role 키는 헤더로만 가고 URL·본문에 없으며, 저장소 실패 응답에는 주소도 키도 원본 오류 문구도 없습니다(`src/lib/autoreply/supabase-store.test.ts`).
- **댓글 원문·작성자·답글 문구 저장 불가**: 마이그레이션의 열 이름을 전부 열거해 텍스트를 담을 열이 없음을 확인하고, 저장 계약 타입과 30일 삭제 함수, 그 함수를 예약 실행이 부르는 것까지 확인합니다(`src/lib/autoreply/no-comment-text-stored.test.ts`).
- **승인이 문구를 정하지 못함**: `send` 요청에 `text`/`draft`를 넣어도 무시되고 서버가 만든 초안이 나가며, 응답에는 댓글 원문도 답글 문구도 없습니다(`src/app/api/auto-reply/routes.test.ts`).
- **상태 저장소 함수는 서버 역할만 부를 수 있음**: 마이그레이션의 함수는 `security definer`라서 옆에 켜 둔 RLS를 지나가고, PostgreSQL은 함수를 만들 때 EXECUTE를 PUBLIC에 줍니다. 그래서 마이그레이션은 선언한 함수 21개 전부에 대해 `revoke execute … from public, anon, authenticated` 뒤 `grant execute … to service_role`만 합니다. 테스트는 revoke 줄의 이름을 믿지 않고 `create or replace function` 선언에서 인자 타입까지 서명을 직접 만들어 대조하므로, revoke 줄의 오타는 "함수가 열린 상태"가 아니라 실패하는 테스트가 됩니다. `grant` 줄 개수가 선언된 함수 개수와 같고 모두 `to service_role;`로 끝나는지, 표 4개에 RLS가 켜져 있고 정책이 하나도 없는지, 어댑터가 부르는 `ch20_*` 이름과 선언된 이름이 양방향으로 일치하는지도 함께 확인합니다(`src/lib/autoreply/store-permissions.test.ts`).

## 의존성 감사

현재 20장 작업 트리에서 `npm ci` 후 `npm audit --audit-level=high`를 다시 실행해 취약점 0건을 확인했습니다. Next 16.3.5, eslint-config-next 16.3.5, Vitest 4.1.11을 유지하며 20장은 새 의존성을 추가하지 않았습니다.

## UNVERIFIED — 실계정·실 API가 있어야만 확인되는 것

- [ ] 정정된 `youtube.force-ssl` 범위로 실제 동의·Token 교환·`commentThreads.list` 호출을 다시 실행해 확인 — 이 정정은 2026-09-14 실계정에서 관찰된 `youtube.readonly` 403 `insufficientPermissions`가 계기이며, fixture 테스트는 로더가 `youtube.force-ssl`만 허용하고 `youtube.readonly`/18장 상태변경 Token의 `.../auth/youtube`를 거부함을 검증했지만, 정정된 흐름으로 실제 Google 동의 화면을 다시 통과해 살아있는 Token을 발급받고 `commentThreads.list`가 실제로 성공하는지는 아직 확인하지 않았습니다 (18장 client JSON의 OAuth 앱 자체는 계속 재사용합니다)
- [ ] 실제 채널·시험 영상의 소유·공개 범위 확인 (`channels.list`/`videos.list` 실제 응답)
- [ ] 실제 댓글 조회 결과 (0건/정상/비활성/권한/할당량 등 실제 API 응답)
- [ ] 실제 Gemini 키·모델로의 분류·초안·검사 응답 (현재는 전부 fixture로 대체)
- [ ] Google AI 서비스 약관·데이터 처리 조건의 실제 확인 (README의 공식 링크에서 사람이 직접 확인)
- [ ] 실제 화면 촬영
- [ ] 실제 `comments.insert` 1건 전송과, 그 답글이 YouTube에 실제로 보이는지의 외부 확인
- [ ] 실제 Supabase에서 `supabase/migrations/20260914000000_ch20_auto_reply.sql` 실행과 RPC 동작 확인
- [ ] 실제 배포 서버에서 19장 미리보기 세 경로가 404로 닫히고 화면(`/`)은 200 안내 화면으로 뜨는지 확인
- [ ] 실제 배포 서버(Vercel 등)에서 자격증명을 파일 없이 `YOUTUBE_OAUTH_CLIENT_JSON`/`YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON`으로만 주고 Token 갱신이 실제로 성공하는지 확인
- [ ] `supabase/cron/README.md` 절차로 일정 등록과, 등록·요청 도달·서버 처리 세 층의 실제 확인
- [ ] `halted_result_unknown` 복구 절차의 실제 확인

## write 경로는 정확히 하나

`src/app/api`에는 19장의 `video`·`comments`·`review`(모두 조회·분류) 세 경로와 20장의 `auto-reply/{enable,prepare,run,send,status,stop,target}` 일곱 경로가 있습니다. 그중 `prepare`는 초안을 보여 주기만 하고 전송 경로가 없습니다. YouTube에 쓰는 호출은 `src/lib/youtube/reply-client.ts`의 `comments.insert` 하나뿐이고, 댓글 수정·삭제·차단·스팸 신고와 영상 변경 경로는 없습니다. 이 경계는 `src/app/bounded-write-surface.test.ts`가 전체 로컬 게이트에서 정적으로 재확인했습니다.

## 이 세션에서 하지 않은 일 (명시)

- 실제 YouTube 답글 전송: 하지 않았습니다. 모든 전송 경로는 Fake 클라이언트로만 시험했습니다.
- Supabase 마이그레이션 실행, 일정(cron) 등록, 배포, 권한 변경: 하지 않았습니다.
- 로컬 Test·lint·typecheck·build·audit는 실행해 통과했습니다. 실제 외부 계정·배포·촬영 근거는 아직 없습니다.
- 그래서 이 저장소 상태는 아직 촬영 준비(CAPTURE_READY)가 아닙니다.

## 이번 결함 수정의 추가 검증 범위

만료 lease 자동 인수 금지, POST timeout의 결과 미확인 처리, DB 확정 실패 후 잠금 보존, 승인 토큰 없는 내부 전송 거절, 명시적 대상 준비, 최근 실행 기록의 최소 정보와 RPC 권한을 로컬 회귀 검사합니다. 최근 실행은 완료 시각 없는 중단과 전송 0건 완료를 구분합니다. 실제 YouTube·Supabase migration·Cron·배포 성공을 뜻하지 않습니다.

## 2026-09-14 필수 결함 수정 후 로컬 검사

인증정보를 제외한 분리 복사본에서 확인했습니다. 제품 API는 모두 Mock/Fake이며 실제 댓글 전송·예약 활성화·배포는 실행하지 않았습니다.

| 검사 | 결과 |
|---|---|
| npm test | 39 files / 596 tests PASS |
| npm run lint | PASS |
| npm run typecheck | PASS |
| npm run build | PASS / 12 routes |
| npm audit --audit-level=high | 취약점 0 |
| git diff --check | PASS |
| 브라우저 시험 대역 | 대상 준비/확인 취소/문장 준비/예약 확인 취소/최근 실행 0건·미완료/390px 가로 넘침 없음 PASS |

의존성은 기존 설치본의 파일 복사로 분리했으며 이번 검사에서 npm ci를 다시 실행하지 않았습니다. 실제 Supabase migration 적용과 독자 프롬프트 재현, 실계정 전송, 정식 촬영 완료를 뜻하지 않습니다.

독립 재심 지적 보완: 전송 성공 후 통계 조회 실패에서도 실행 기록의 전송 수를 보존하며, 예약 켜기는 화면에서 확인한 기준 시각이 바뀌면 거절합니다. 중단 상태의 수동 전송 안내와 README·Cron 설명을 같은 계약으로 정리했습니다.

추가 계약 검사: 자기 댓글 자동 제외·자기 댓글 수동 승인·인증/한도 오류 후 호출 중단·기존 답글 확인·최근 1시간 동일 문장 보류·조회 중 중지 재확인·조회 실패 시 잠금 반납을 검증했습니다. 원문 저장이나 자동 복구 기능은 추가하지 않았습니다.

실제 PostgREST의 void 함수는 HTTP 204·빈 본문을 반환합니다. 실행 시작·종료·전송 확정 등 void 쓰기는 이를 성공으로 처리하며, 객체가 필요한 조회의 빈 응답은 계속 거절합니다. 실서비스 응답에서 발견해 회귀 검사에 추가했습니다.
