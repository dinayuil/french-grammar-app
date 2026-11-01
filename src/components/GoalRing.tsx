export function GoalRing({ done, goal }: { done: number; goal: number }) {
  const r = 45;
  const c = 2 * Math.PI * r;
  const ratio = goal > 0 ? Math.min(done / goal, 1) : 0;
  const offset = c * (1 - ratio);
  return (
    <svg className="goal-ring" viewBox="0 0 110 110" width="96" height="96">
      <circle cx="55" cy="55" r={r} className="goal-ring-track" />
      <circle
        cx="55"
        cy="55"
        r={r}
        className={ratio >= 1 ? "goal-ring-fill goal-ring-done" : "goal-ring-fill"}
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 55 55)"
      />
      <text x="55" y="52" textAnchor="middle" className="goal-ring-xp">
        {done}
      </text>
      <text x="55" y="70" textAnchor="middle" className="goal-ring-goal">
        / {goal}
      </text>
    </svg>
  );
}
