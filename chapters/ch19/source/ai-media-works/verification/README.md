# 검증 상태 — 19장. 유튜브 댓글 읽기·분류·초안 미리보기

이 문서는 로컬 fixture로 실제 확인한 것(IMPLEMENTED)과, 실계정·실제 Gemini 응답이 있어야만 확인되는 것(UNVERIFIED)을 구분합니다. 값은 아래 명령을 실제로 실행해 얻은 결과이며, 재현 명령을 그대로 다시 실행하면 같은 결과를 확인할 수 있습니다.

## 이 프로젝트가 하는 일 (기능 범위)

- 내 채널이 소유한 시험 영상 한 편의 최상위 댓글을 `commentThreads.list`로 최신순 최대 20개 읽습니다 (읽기 전용).
- 댓글을 다섯 종류로 분류하고, 서버가 고정한 표에 따라 세 처리 수준(자동답글 후보 / 사람 확인 / 답하지 않음)으로 나눕니다.
- 자동답글 후보에만 짧은 한국어 초안을 만들고, 프로그램 검사와 별도의 AI 문맥 검사를 모두 통과해야 후보로 유지합니다.
- 모든 결과는 브라우저 화면에서만 보이며, YouTube에 쓰는 API 호출은 어디에도 없습니다.

## 재현 명령과 실측 결과

아래는 `node_modules`와 `.next`를 지우고 `npm ci`로 처음부터 다시 설치한 뒤, 이 저장소 루트에서 실행한 결과입니다.

```
$ npm test                       → exit 0 (Test Files 27 passed, Tests 331 passed)
$ npm run lint                   → exit 0 (eslint .)
$ npm run typecheck              → exit 0 (tsc --noEmit)
$ npm run build                  → exit 0 (Next.js 16.3.5, Turbopack; routes: /, /api/video, /api/comments, /api/review)
$ npm audit --audit-level=high   → found 0 vulnerabilities
$ git diff --check               → 출력 없음 (공백 오류 없음)
```

## Mock 범위 (외부 API 호출 없이 검증한 것)

- **Gemini 응답 스키마 fail-closed**: `src/lib/gemini/schema.ts`가 `category`/`mixedSignals`/`draft`/`passed`/`reason`을 엄격하게 검사합니다. `passed`는 정확히 boolean `true`일 때만 통과이고, malformed JSON·누락·null·배열·숫자·문자열 `"false"`·정해지지 않은 category는 모두 던져서 실패로 처리됩니다(`src/lib/gemini/schema.test.ts`, `src/lib/gemini/real-client.test.ts`).
- **한 영상·공개 범위·최대 20개 서버 강제**: `/api/comments`는 채널 소유와 공개 범위(public/unlisted만)를 요청마다 다시 확인하고, 그 외 상태는 `commentThreads.list` 호출 전에 차단합니다. `/api/review`는 1~20개만 허용하고 중복 ID·과도한 길이·잘못된 날짜를 400으로 거부하며, 응답 형식이 어긋나면 500 대신 명시적 안전 오류를 반환합니다(`src/app/api/comments/route.test.ts`, `src/app/api/review/route.test.ts`, `src/lib/comments/request-validation.test.ts`, `src/lib/youtube/schema.ts`).
- **YouTube 쓰기 요청 0건**: `src/lib/youtube/real-client.test.ts`가 모든 호출을 기록해 OAuth 토큰 갱신(POST, `oauth2.googleapis.com`) 외 모든 `googleapis.com` 호출이 GET임을 단언하고, 클라이언트 인터페이스에 읽기 메서드 세 개만 있음을 단언합니다. `src/app/no-write-surface.test.ts`는 소스 전체를 정적으로 스캔해 `comments.insert(`/`commentThreads.insert(`/`videos.update(` 호출과 Chat/Supabase 참조가 없음을 확인합니다.
- **분류·초안·검사 파이프라인**: 단순 응원, 후속 요청, 질문, 사실 지적, 광고, 혼합 신호, 프롬프트 인젝션, 개인정보, 빈 문장, 장문에 대한 fixture 시험이 통과합니다(`src/lib/comments/pipeline.test.ts`).
- **로컬 OAuth 설정 스크립트의 실패 경로**: 취소, state 불일치, 콜백 오류, 범위 누락, `refresh_token` 누락, 포트 충돌을 Mock HTTP·Mock 콜백 요청으로 검증합니다(`scripts/tests/`).
- **댓글 읽기용 Token 파일·Token 갱신 응답의 엄격한 검증 (2026-09-14 정정)**: 실제 계정으로 `commentThreads.list`를 호출해 `youtube.readonly` Token이 HTTP 403 `insufficientPermissions`를 반환하는 것을 확인한 뒤, 공식 Discovery 문서를 기준으로 허용 범위를 다시 정의했습니다. `loadRefreshToken`은 파일이 객체가 아니거나, `refresh_token`이 문자열이 아니거나, 부여된 범위가 정확히 `https://www.googleapis.com/auth/youtube.force-ssl` 단독이 아니면 API 호출 전에 fail-closed합니다 — `youtube.readonly`와 18장 상태변경 Token의 `.../auth/youtube`는 더 이상 허용 목록에 없으며(둘 다 공식 Discovery 문서에서 `commentThreads.list`의 허용 범위로 나열되지 않음), `youtube.upload`와 마찬가지로 네트워크 요청(토큰 갱신 POST) 전에 거부됩니다. 범위는 단일 공백구분 `scope` 문자열과 Google `Credentials.to_json`이 만드는 `scopes` 배열 두 형태 모두 안전하게 읽되, 배열에 문자열이 아닌 값이 있으면 malformed로 거부합니다. 범위 필드가 전혀 없거나 알려지지 않은 범위만 있는 경우도 모두 네트워크 요청 전에 거부되며, 각 테스트가 `fetchMock`이 호출되지 않았음을 단언합니다. OAuth Token 갱신 응답도 `access_token`이 빈 문자열/누락이거나 `expires_in`이 숫자가 아니거나(문자열 `"3600"` 포함) 0 이하이면 `Authorization: Bearer undefined`를 보내지 않고 즉시 실패합니다(`src/lib/youtube/real-client.test.ts`). Token 파일을 자동으로 찾거나 경로·내용을 출력하는 코드는 없고, 이 로더는 파일을 쓰거나 갱신하지 않습니다 — access token 캐시는 메모리에만 있고(`cachedToken`), `YoutubeClient`에는 읽기 메서드 세 개만 있습니다.
- **로컬 OAuth 설정의 레이스·응답·경로 안전성**: 콜백 서버가 실제로 listening 상태가 된 뒤(`ready` 계약)에만 동의 URL을 출력하고, 포트 충돌 시 `ready`가 즉시 실패로 settle되어 멈추지 않습니다. 콜백 페이지는 `text/plain`과 고정 문구만 반환해 Google의 `error` 파라미터를 그대로 반사하지 않습니다. `loadOAuthClient`는 Desktop(`installed`) 형식만 허용하고 `web`·flat 형식을 거부합니다. Token 저장 경로는 프로젝트 안의 고정된 한 경로로 제한되고(CLI에 경로를 바꾸는 인자가 없음), client JSON과 같은 경로나 프로젝트 밖 경로는 거부합니다. 저장은 임시 파일 작성 후 원자적 rename으로 이뤄지고(0600, 실패 시 임시 파일 잔류 없음) 검증되지 않은 Token으로 기존 파일을 먼저 건드리지 않습니다(`scripts/tests/callback-server.test.mjs`, `scripts/tests/client-json.test.mjs`, `scripts/tests/token-output-path.test.mjs`, `scripts/tests/setup-youtube-comment-read-oauth.test.mjs`, `scripts/tests/secure-store.test.mjs`).
- **영상·채널 조회 실패의 안전한 분류**: `/api/video`의 영상·채널 조회 실패는 `status:"ok"` 카드 안의 원문 영어 오류가 아니라, 닫힌 집합의 `reason`과 한국어 안내가 담긴 `status:"error"`로 돌아옵니다. `/api/comments`의 소유·공개 범위 확인 실패도 raw `detail` 필드 없이 같은 방식으로 분류됩니다. 주소가 잘못됐거나 영상이 지워진 경우(`videos.list`의 빈 `items`, `commentThreads.list`의 404)와 연결된 계정에 채널이 없는 경우(`channels.list`의 빈 `items`)는 `video_not_found`/`channel_not_found`로 따로 분류해 404로 돌려주므로, 응답 형식 오류나 통신 실패와 섞이지 않습니다(`src/lib/youtube/error-classification.test.ts`, `src/app/api/video/route.test.ts`, `src/app/api/comments/route.test.ts`).
- **읽지 못한 항목의 공개**: `commentThreads.list`가 돌려준 항목 중 형태를 읽을 수 없는 것이 섞여 있으면 나머지 댓글은 그대로 보여주고 제외한 개수(`skippedCount`)를 화면에 함께 표시합니다. 목록이 조용히 짧아지지 않고, 모든 항목을 읽지 못한 경우는 빈 목록이 아니라 오류로 처리됩니다. 다른 시청자의 댓글에는 `snippet.textOriginal`이 오지 않으므로(공식 Comments 자료, 2026-09-14 확인) 화면에 쓰는 본문은 `textFormat=plainText`로 받은 `textDisplay`입니다(`src/lib/youtube/schema.ts`, `src/lib/youtube/real-client.test.ts`, `src/app/api/comments/route.test.ts`).
- **설정 오류의 타입 기반(닫힌) 분류**: 환경변수 누락, client/token 파일을 읽거나 파싱할 수 없는 경우, 부여된 범위가 부족한 경우는 각각 `YoutubeConfigMissingError`/`YoutubeCredentialFileError`/`YoutubeScopeInsufficientError` 타입으로 던져지고, 분류기는 `error.message` 문자열이 아니라 `instanceof`로 판별합니다 — 그 메시지가 로컬 파일 경로를 담고 있어도 브라우저로 가는 고정된 한국어 안내문에는 그 경로가 전혀 섞이지 않습니다. 리더 UI는 이 세 경우 모두에 실행 가능한 다음 행동(18장 Token은 이 범위를 부여하지 않으므로 재사용할 수 없다는 안내, 정확한 `npm run setup:youtube-comment-read -- <client_secret*.json 경로>` 명령, 설정된 두 경로와 README 확인)을 보여줍니다(`src/lib/youtube/error-classification.test.ts`, `src/lib/youtube/real-client.test.ts`, `src/app/api/video/route.test.ts`, `src/app/api/comments/route.test.ts`, `src/app/home-client-wording.test.ts`).
- **Gemini 실패의 닫힌 분류와 fail-closed 다운그레이드**: `src/lib/gemini/error-classification.ts`가 `config_missing`/`auth_error`/`quota_exceeded`/`model_or_request_error`/`network_error`/`invalid_response`/`service_error` 일곱 개로만 분류합니다. `GeminiConfigMissingError`(타입 기반)와 `GeminiSchemaError`는 `instanceof`로, `@google/genai`의 `ApiError.status`(401/403→auth_error, 429→quota_exceeded, 400/404→model_or_request_error)와 `TypeError`/SDK 내부 `HTTPClientError` 계열의 고정된 `name`(→network_error)은 값으로 판별하며, 그 외는 모두 `service_error`로 fail-closed합니다. 어떤 사유든 `error.message`·경로·키·호스트 문자열은 분류기와 고정 한국어 안내문 어디에도 섞이지 않습니다(raw 문자열 비노출을 직접 단언하는 테스트 포함, `src/lib/gemini/error-classification.test.ts`, `src/lib/gemini/real-client.test.ts`). 분류/초안/AI 문맥검사 중 어느 Gemini 호출이 실패해도 해당 댓글은 예외 없이 `HUMAN_REVIEW`로 남고 자동답글 후보로 절대 올라가지 않으며, `CommentReviewItem.geminiIssue`에 실패 단계(`classification`/`draft`/`context_check`)와 사유가 남습니다 — 빈 댓글·개인정보 같은 로컬 안전장치나 프로그램 검사 단독 실패는 Gemini 장애로 기록되지 않습니다(`src/lib/comments/pipeline.test.ts`). `/api/review`는 `GEMINI_API_KEY`/`GEMINI_MODEL` 누락을 호출 전에 안전한 `status:"error"`(`reason:"config_missing"`)로 즉시 차단하고, 배치 중 하나라도 `geminiIssue`가 있으면 `status:"ok"`가 아니라 `status:"partial"`로 반환해 실제 Gemini 전체 성공과 혼동될 수 없게 합니다 — 이 상태에서도 안전하게 다운그레이드된 항목은 그대로 반환됩니다(`src/app/api/review/route.test.ts`). 리더 UI는 `status:"partial"`일 때 "실제 Gemini 성공이 아닙니다"라는 경고와, 배치에 나타난 사유마다 정확히 하나의 실행 가능한 다음 행동(키/모델 설정 후 재시작, 키 권한 확인, 사용량 확인, 지원 모델·요청 확인, 인터넷 확인, 잠시 후 재시도)을 보여주며 원문 오류 텍스트는 노출하지 않습니다(`src/app/home-client-wording.test.ts`).

## 의존성 감사

`npm ci` 후 `npm audit` 결과 취약점 0건(info/low/moderate/high/critical 모두 0). Next 16.3.5, eslint-config-next 16.3.5, Vitest 4.1.11로 갱신했습니다.

## UNVERIFIED — 실계정·실 API가 있어야만 확인되는 것

- [ ] 정정된 `youtube.force-ssl` 범위로 실제 동의·Token 교환·`commentThreads.list` 호출을 다시 실행해 확인 — 이 정정은 2026-09-14 실계정에서 관찰된 `youtube.readonly` 403 `insufficientPermissions`가 계기이며, fixture 테스트는 로더가 `youtube.force-ssl`만 허용하고 `youtube.readonly`/18장 상태변경 Token의 `.../auth/youtube`를 거부함을 검증했지만, 정정된 흐름으로 실제 Google 동의 화면을 다시 통과해 살아있는 Token을 발급받고 `commentThreads.list`가 실제로 성공하는지는 아직 확인하지 않았습니다 (18장 client JSON의 OAuth 앱 자체는 계속 재사용합니다)
- [ ] 실제 채널·시험 영상의 소유·공개 범위 확인 (`channels.list`/`videos.list` 실제 응답)
- [ ] 실제 댓글 조회 결과 (0건/정상/비활성/권한/할당량 등 실제 API 응답)
- [ ] 실제 Gemini 키·모델로의 분류·초안·검사 응답 (현재는 전부 fixture로 대체)
- [ ] 실습 전후 실제 YouTube 계정에 답글이 없는지의 외부 확인
- [ ] Google AI 서비스 약관·데이터 처리 조건의 실제 확인 (README의 공식 링크에서 사람이 직접 확인)
- [ ] 실제 화면 촬영

## write 경로 없음

`src/app/api`에는 `video`(조회), `comments`(조회), `review`(분류·초안 생성) 세 경로만 있습니다. 이 셋 중 어느 것도 YouTube에 쓰는 API를 호출하지 않으며, 이는 `src/app/no-write-surface.test.ts`가 매 테스트 실행마다 정적으로 재확인합니다.
