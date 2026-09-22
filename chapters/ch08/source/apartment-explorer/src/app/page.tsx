import ApartmentSearchForm from "./ApartmentSearchForm";

/*
  이 화면의 주인공은 제목이 아니라 검색 조건과 결과다.
  그래서 머리말은 "무엇을 확인해 주는 서비스인지" 두 줄로만 말하고 비켜선다.
*/
export default function Home() {
  return (
    <main>
      <header className="hero">
        <p className="eyebrow">국토교통부 실거래 자료</p>
        <h1>아파트 찾기</h1>
        <p className="hero-copy">
          최근 1년 동안 실제로 거래된 기록에서, 원하는 면적과 가격으로 거래된 단지를 찾아
          지하철역·초등학교까지의 거리와 함께 보여 줍니다. 현재 매물이나 추천 순위가 아닙니다.
        </p>
      </header>
      <ApartmentSearchForm />
    </main>
  );
}
