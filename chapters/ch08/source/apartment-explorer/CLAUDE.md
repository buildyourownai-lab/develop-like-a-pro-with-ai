@AGENTS.md

# 프로젝트 규칙

## 아파트 찾기
- "아파트 찾기"는 `src/lib/apartmentSearch.ts`의 `searchApartments` 함수(지역 해석은
  `src/lib/region.ts`의 `resolveRegion`, API 라우트는
  `src/app/api/apartments/search/route.ts`)로 이미 구현되어 있다.
- 브라우저에서 쓰는 검색 화면은 아직 없다.
- 이후 "아파트 찾기"를 요청받으면 새로 만들지 말고 이 기존 기능을 그대로
  사용한다. 조건(지역, 면적, 가격, 지하철·초등학교 거리)을 받아 위 함수/라우트를
  호출해 결과를 알려준다.
- 기능 자체를 바꿔야 하는 요청이면, 새로 만들지 말고 이 기존 코드를 수정한다.
