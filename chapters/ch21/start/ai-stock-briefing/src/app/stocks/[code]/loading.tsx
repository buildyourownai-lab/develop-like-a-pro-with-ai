export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="skeleton" style={{ height: 32, width: 130, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 48, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 250, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 430 }} />
    </div>
  );
}
