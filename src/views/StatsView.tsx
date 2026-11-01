import type { Progress } from "../types";
import { shiftDate, today } from "../storage";
import { levelFor, streakFor } from "../engine";

export function StatsView({ progress }: { progress: Progress }) {
  const t = today();
  const last7 = Array.from({ length: 7 }, (_, i) => shiftDate(t, -(6 - i)));
  const max = Math.max(...last7.map((d) => progress.days[d]?.xp ?? 0), 1);

  return (
    <div className="stats">
      <div className="stats-top">
        <div className="stat-box">
          <div className="stat-num">{progress.xp}</div>
          <div className="stat-label">累计 XP</div>
        </div>
        <div className="stat-box">
          <div className="stat-num">{levelFor(progress.xp)}</div>
          <div className="stat-label">等级</div>
        </div>
        <div className="stat-box">
          <div className="stat-num">{streakFor(progress.days, progress.dailyGoal, t)}</div>
          <div className="stat-label">连击</div>
        </div>
      </div>

      <div className="stats-title">最近 7 天</div>
      <div className="bars">
        {last7.map((d) => {
          const xp = progress.days[d]?.xp ?? 0;
          const isToday = d === t;
          return (
            <div key={d} className="bar-col">
              <div className="bar-num">{xp > 0 ? xp : ""}</div>
              <div className="bar-track">
                <div
                  className={`bar-fill ${isToday ? "bar-today" : ""}`}
                  style={{ height: `${(xp / max) * 100}%` }}
                />
              </div>
              <div className="bar-label">{d.slice(5)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
