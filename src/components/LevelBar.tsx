import { levelFor } from "../engine";
import { XP_PER_LEVEL } from "../config";

export function LevelBar({ xp }: { xp: number }) {
  const level = levelFor(xp);
  const inLevel = xp % XP_PER_LEVEL;
  return (
    <div className="level-bar">
      <div className="level-text">
        <span className="level-num">等级 {level}</span>
        <span className="level-xp">
          {inLevel}/{XP_PER_LEVEL} XP
        </span>
      </div>
      <div className="level-track">
        <div className="level-fill" style={{ width: `${(inLevel / XP_PER_LEVEL) * 100}%` }} />
      </div>
    </div>
  );
}
