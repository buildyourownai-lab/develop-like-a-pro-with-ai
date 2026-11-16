# 8장을 끝낸 상태의 apartment-explorer

## 이 Source는 언제 사용하나요?

7장의 아파트 찾기에 브라우저에서 쓰는 화면을 붙인 상태입니다. 정답지가 아닙니다.

책을 따라가다 막혔을 때 순서는 이렇습니다.

```text
디버깅 → 내 정상 기록으로 복구 → 장별 Source로 재시작
```

이 Source는 마지막 단계입니다. 앞의 두 방법으로도 이어갈 수 없을 때, 9장부터 계속
진행하기 위해 사용합니다. 이 Source로 시작하면 8장의 남은 실습은 건너뛰게 됩니다.

## 무엇이 들어 있나요?

7장까지 만든 것이 그대로 있고, 여기에 8장의 아파트 찾기 화면이 더해졌습니다.

| 무엇 | 어디 |
|---|---|
| 브라우저에서 조건을 입력하고 결과를 보는 화면 | src/app/ApartmentSearchForm.tsx |
| 화면이 조건과 결과와 오류를 제대로 다루는지 확인하는 Test | src/app/ApartmentSearchForm.test.tsx |
| 조건에 맞는 아파트 단지를 찾는 기능 | src/lib/apartmentSearch.ts |
| 평소 쓰는 주소를 실거래가 조회 지역으로 연결하는 기능 | src/lib/region.ts |
| 아파트 찾기를 실행하는 자리 | src/app/api/apartments/search/route.ts |
| 국토교통부 실거래가 응답을 읽는 기능 | src/lib/molit.ts |
| Kakao 주소와 주변 장소 응답을 읽는 기능 | src/lib/kakao.ts |
| 응답 예시 | src/lib/__fixtures__/ |

두 개의 키는 들어 있지 않습니다. .env.example을 보고 자기 키를 넣으면 됩니다. 키 없이도
저장해둔 응답 예시로 Test를 실행할 수 있습니다.

두 키는 서버에서만 사용합니다. 브라우저가 받아가는 파일에는 키 이름도 값도 들어가지
않습니다.

## Claude Code에서 이어서 사용하기

이 폴더를 Claude Code에서 열고 그대로 입력하면 됩니다.

```text
이 폴더는 책 8장을 끝낸 상태의 프로젝트야.
실행에 필요한 환경이 준비되어 있는지 확인하고, 없으면 준비해줘.
내 키를 넣을 자리를 알려주고 Test를 실행해서 결과를 보여줘.
그다음 브라우저에서 화면을 확인할 방법도 알려줘.
```

## 내 결과와 달라도 괜찮습니다

같은 요청문을 입력해도 파일 이름과 함수 이름, 화면 모양은 달라집니다. 기준은 코드가 같은지가
아니라 8장의 완료 조건을 만족하는지입니다.

- 브라우저 화면에서 지역과 면적, 실거래 가격, 생활조건을 입력해 아파트를 찾습니다.
- 실거래 가격 범위가 현재 매물 가격이 아니라는 것을 화면에서 알 수 있습니다.
- 아파트를 선택하면 검색의 근거가 된 실제 거래 내역을 볼 수 있습니다.
- 조건에 맞는 결과가 0건인 것과 검색 자체가 끝나지 못한 것을 구분해 알려줍니다.
- 국토교통부 데이터 오류와 Kakao 데이터 오류를 서로 구분해 알려줍니다.
- 두 키가 브라우저로 전달되지 않습니다.
- 7장까지의 검색 규칙이 그대로 유지되고 기존 Test도 계속 통과합니다.

## 검증 결과

빈 폴더에 이 Source만 놓고 준비와 Test 실행까지 확인했습니다. Test 39개가 모두
통과했습니다. 근거는
[verification/chapter-08/](../../../../verification/chapter-08/)에 있습니다.

## Cloudflare Workers에서 실행하기

이 Source는 정적 Pages가 아니라 OpenNext로 Next.js 서버를 Workers에 올립니다.
Node의 `npm run dev`는 기존 직접 호출을 유지합니다. Workers에서는 Kakao 요청을
비공개 서비스 바인딩 `KAKAO_BATCH`로 보냅니다. 화면과 검색 규칙은 같습니다.

```sh
npm ci
npm test
npm run lint
npm run build:cloudflare
npm run preview:cloudflare
```

로컬 Worker용 값은 Git에서 제외된 `.dev.vars`에 `MOLIT_SERVICE_KEY`와
`KAKAO_REST_API_KEY`로 준비합니다. `.env.local`을 Worker가 자동으로 읽는다고
가정하지 않습니다. 국토교통부 키의 인코딩은 `.env.example` 안내를 따릅니다.
완성 서비스가 `DATA_GO_KR_SERVICE_KEY`라는 이름을 쓰더라도 여기서는 같은 키를
`MOLIT_SERVICE_KEY`로 읽으며 새 키를 발급받는 것이 아닙니다.

실제 배포는 별도 작업입니다. `wrangler.jsonc`의 주 Worker 이름과 서비스 바인딩,
`wrangler.kakao.jsonc`의 비공개 Worker 이름을 함께 맞춘 뒤 자기 계정으로 로그인합니다.
주 Worker에 두 키를 Secret으로 등록하고, `npm run deploy:cloudflare`로 비공개 Worker를
먼저 올린 뒤 주 Worker를 올립니다. 비공개 Worker에는 공개 경로를 만들지 않습니다.
Git 연동 자동 배포를 선택하면 빌드 명령과 두 Worker의 배포 순서를 함께 설정해야 합니다.
빌드 성공과 실제 주소에서의 검색 성공은 따로 확인합니다.
