import { FlameIcon } from "./icons";

export function StreakFlame({ count }: { count: number }) {
  return (
    <div className={count > 0 ? "streak-flame" : "streak-flame streak-flame-zero"}>
      <span className="streak-badge" aria-hidden="true">
        <FlameIcon />
      </span>
      <span className="streak-copy">
        <span className="streak-count">{count}</span>
        <span className="streak-label">天连击</span>
      </span>
    </div>
  );
}
