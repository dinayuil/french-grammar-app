export function StreakFlame({ count }: { count: number }) {
  return (
    <div className={count > 0 ? "streak-flame" : "streak-flame streak-flame-zero"}>
      <span className="streak-icon">🔥</span>
      <span className="streak-count">{count}</span>
      <span className="streak-label">连击</span>
    </div>
  );
}
