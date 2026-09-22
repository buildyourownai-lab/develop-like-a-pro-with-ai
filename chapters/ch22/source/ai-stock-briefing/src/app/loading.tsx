export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="masthead">
        <div>
          <h1>국내 주식 한눈에</h1>
          <p>공식 데이터를 불러오고 있습니다…</p>
        </div>
      </div>
      <div className="skeleton" style={{ height: 48, marginBottom: 24 }} />
      <div className="grid-2" style={{ marginBottom: 28 }}>
        <div className="skeleton" style={{ height: 132 }} />
        <div className="skeleton" style={{ height: 132 }} />
      </div>
      <div className="movers">
        <div className="skeleton" style={{ height: 320 }} />
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    </div>
  );
}
