<p align="left"><img src="assets/brand/book-symbol.png" alt="책 심벌" width="13%"><img src="assets/brand/brand-divider.svg" alt="" width="4.1%"><img src="assets/brand/book-title.svg" alt="프로처럼 AI로 코딩 없이 개발하기" width="49.6%"><img src="assets/brand/brand-divider.svg" alt="" width="4.1%"><img src="assets/brand/repository-title.svg" alt="AI 미디어 운영" width="24.2%"></p>

# ai-media-works — 19장. 유튜브 댓글 읽기·분류·초안 미리보기

내 채널의 시험 영상 한 편에서 공개 또는 일부 공개(unlisted) 최상위 댓글을 최신순 최대 20개 읽고, 다섯 종류·세 처리 수준으로 나눈 뒤 자동답글 후보에만 짧은 한국어 초안을 만들어 **내 컴퓨터에서만** 미리 봅니다. 이 프로젝트는 YouTube에 아무것도 쓰지 않습니다 — 보내기 버튼과 댓글 작성 API가 없습니다.

20장에서 이 프로젝트를 이어가 승인한 후보만 실제로 전송합니다.

## 이 장에 없는 것

이 장은 댓글 읽기·분류·초안 준비까지만 다룹니다. 실제 답글 전송과 공개 배포는 다음 장에서 추가합니다.

## 준비물

- Node.js 20 이상
- 18장에서 만든 Google Cloud 프로젝트의 OAuth Desktop client JSON 파일 (client_secret*.json — 읽기 전용으로 재사용, 이 앱은 그 파일을 절대 덮어쓰지 않습니다)
- 댓글이 허용된 내 채널의 공개 또는 일부 공개(unlisted) 시험 영상 한 편
- 11장에서 사용한 Google AI Studio 계정의 Gemini API 키

## 실행

```bash
npm install
cp .env.example .env.local   # 이름만 있는 예시입니다. 실제 값은 이 파일에만 직접 입력합니다.
```

`.env.local`을 열어 `GEMINI_API_KEY`, `GEMINI_MODEL`, `YOUTUBE_OAUTH_CLIENT_JSON_PATH`를 채운 뒤, 아래 "로컬 OAuth 설정"을 먼저 읽고 `YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH`를 정하세요. 그 다음:

```bash
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## 로컬 OAuth 설정 (댓글 읽기)

**정정 사항 (2026-09-14):** 이 절은 실제 계정으로 `commentThreads.list`를 불러본 뒤 바로잡았습니다. 소유가 확인된 공개 영상(`2HkP_1fahLQ`)에서 `videos.list`는 정상 응답했지만 `commentThreads.list`는 `youtube.readonly` 범위의 Token으로 HTTP 403 `insufficientPermissions`를 반환했습니다. Google YouTube Data API v3의 공식 Discovery 문서를 다시 확인한 결과, `commentThreads.list`/`comments.list`를 허용하는 범위는 `https://www.googleapis.com/auth/youtube.force-ssl` 하나뿐이며 `youtube.readonly`도, 18장 상태변경(status-change) Token이 가진 `https://www.googleapis.com/auth/youtube`도 그 목록에 없습니다. 이 장의 서버는 `channels.list`/`videos.list`/`commentThreads.list`만 부르므로(쓰기 메서드 없음), 이제 정확히 `youtube.force-ssl` 범위의 Token만 인정합니다 — **18장 Token(상태변경·읽기 전용 어느 쪽이든)은 더 이상 재사용할 수 없습니다.** Google 콘솔은 `youtube.force-ssl`을 "YouTube 데이터 관리"처럼 넓게 표시하지만, 이 장 소스에는 `comments.insert`/`update`/`delete`나 그 밖의 쓰기 경로가 전혀 없습니다 — `src/lib/youtube/real-client.ts`에 읽기 메서드 세 개만 있고, `src/app/no-write-surface.test.ts`가 이를 매 테스트마다 정적으로 재확인합니다.

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

**사람이 확인해야 하는 지점:** Google 동의 화면은 `youtube.force-ssl` 범위를 `YouTube 데이터 관리`처럼 넓은 관리 권한으로 표시하고, 이 플랫폼 범위 자체는 쓰기 메서드도 허용할 수 있습니다. 하지만 이 장의 고정 소스 코드는 조회 GET 호출 세 개(`channels.list`, `videos.list`, `commentThreads.list`)만 실행합니다 — `src/lib/youtube/real-client.ts`에 읽기 메서드만 있고, `src/app/no-write-surface.test.ts`가 이를 매 테스트마다 정적으로 재확인합니다. 동의 화면에서 이 범위가 요청됨을 확인하고, 이를 받아들일 때만 진행하세요. 문제가 있으면 Google 계정의 보안 설정에서 이 앱 접근을 제거하고 다시 실행하면 복구됩니다.

## 환경변수

실제 값은 이 문서에도, 대화에도, Git에도 남기지 않습니다. `.env.local`에만 넣고 서버에서만 읽습니다 (`NEXT_PUBLIC_` 접두사가 없으므로 브라우저에 노출되지 않습니다).

| 이름 | 용도 |
|---|---|
| `YOUTUBE_OAUTH_CLIENT_JSON_PATH` | 18장 OAuth Desktop client JSON 파일 경로 (읽기 전용 재사용) |
| `YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH` | 댓글 읽기용(`youtube.force-ssl`) Token 파일 경로. `npm run setup:youtube-comment-read`가 저장한 이 장 전용 Token 경로를 넣습니다 — 18장 Token은 이 범위를 부여하지 않으므로 재사용할 수 없습니다 |
| `GEMINI_API_KEY` | Google AI Studio에서 발급한 Gemini 키 |
| `GEMINI_MODEL` | 이 프로젝트가 사용할 Gemini 모델 이름 |

## 명령

```bash
npm run lint                 # ESLint
npm run typecheck            # tsc --noEmit
npm test                     # vitest — 외부 API 호출 없이 fixture로 검증
npm run build                 # 프로덕션 빌드 (배포하지는 않습니다)
npm run setup:youtube-comment-read -- <client_secret.json 경로>
# 항상 .secrets/youtube-comment-read-oauth.json에만 저장합니다.
```

## 안전 경계

- 서버 코드만 인증정보를 읽습니다 — client JSON과 댓글 읽기용 Token 파일 모두 서버에서만 읽고, 브라우저·로그·Git에는 값이 남지 않습니다.
- 댓글 원문·작성자 정보는 DB나 파일에 저장하지 않고, 응답에는 `Cache-Control: no-store`를 붙입니다.
- 댓글 속에 적힌 지시·링크·역할 변경 요청은 자료로만 다루고 따르지 않습니다.
- 개인정보로 보이는 댓글은 Gemini로 보내지 않고 사람 확인으로 남깁니다.
- Gemini 응답은 엄격한 런타임 스키마로 검사합니다 — `passed`는 정확히 boolean `true`일 때만 통과이고, 문자열 `"false"`나 숫자·배열 같은 잘못된 형식은 모두 실패로 처리합니다(`src/lib/gemini/schema.ts`).
- `/api/comments`는 요청마다 채널 소유와 공개 범위(public/unlisted만)를 다시 확인하고, 비공개이거나 공개 범위를 확인할 수 없는 영상은 `commentThreads.list`를 부르기 전에 차단합니다.
- `/api/review`는 한 번에 1~20개 댓글만 받고, 본문·ID 길이와 날짜 형식, 중복 ID를 서버에서 검사합니다.
- 자동답글 후보의 초안은 AI 문맥 검사와 프로그램 검사를 모두 통과해야만 후보로 유지됩니다.
- `src/app/api`에는 조회(video, comments)와 분류·초안(review) 세 경로만 있습니다. 댓글을 쓰는 경로는 없습니다.

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
