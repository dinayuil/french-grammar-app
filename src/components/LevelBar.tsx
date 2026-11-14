import { levelFor } from "../engine";
import { XP_PER_LEVEL } from "../config";

export function LevelBar({ xp }: { xp: number }) {
  const level = levelFor(xp);
  const inLevel = xp % XP_PER_LEVEL;
  return (
    <div className="level-bar">
      <span className="level-num">等级 {level}</span>
      <span className="level-track" aria-hidden="true">
        <span
          className="level-fill"
          style={{ width: `${(inLevel / XP_PER_LEVEL) * 100}%` }}
        />
      </span>
      <span className="level-xp">
        <span className="level-xp-label">升级经验</span>
        {inLevel} / {XP_PER_LEVEL} XP
      </span>
    </div>
  );
}
