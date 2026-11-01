import type { Lesson } from "../types";

interface Props {
  lesson: Lesson;
  /** XP 明细:答题 / 重做 / 过关奖 / 全对奖 */
  breakdown: { quiz: number; redo: number; lesson: number; perfect: number };
  xpGained: number;
  stars: number;
  wrongQids: string[];
  streak: number;
  onRedo: () => void;
  onNext: (() => void) | null;
  onHome: () => void;
}

export function Settlement({ lesson, breakdown, xpGained, stars, wrongQids, streak, onRedo, onNext, onHome }: Props) {
  const perfect = wrongQids.length === 0;
  return (
    <div className="lesson">
      <div className="settlement">
        <div className="settlement-stars">{"⭐".repeat(stars) || "🎯"}</div>
        <div className="settlement-title">{lesson.kind === "challenge" ? "挑战完成!" : "练习完成!"}</div>
        <div className={stars === 3 ? "settlement-sub good" : "settlement-sub"}>
          {stars === 3 ? "全对!零失误!" : `答错 ${wrongQids.length} 题,重做可补回 3 星`}
        </div>

        <div className="xp-breakdown">
          <div className="xp-row">
            <span>答题 XP</span>
            <span className="xp-num">+{breakdown.quiz}</span>
          </div>
          {breakdown.redo > 0 && (
            <div className="xp-row">
              <span>重做错题</span>
              <span className="xp-num">+{breakdown.redo}</span>
            </div>
          )}
          <div className="xp-row">
            <span>过关奖励</span>
            <span className="xp-num">+{breakdown.lesson}</span>
          </div>
          <div className="xp-row">
            <span>全对奖励</span>
            <span className="xp-num">+{breakdown.perfect}</span>
          </div>
          <div className="xp-row xp-total">
            <span>共获得</span>
            <span className="xp-num">+{xpGained} XP</span>
          </div>
        </div>

        <div className="streak-line">🔥 连击 <b>{streak}</b></div>
      </div>

      <div className="quiz-footer">
        <div className="row-actions settlement-actions">
          {!perfect && (
            <button className="btn btn-secondary" onClick={onRedo}>
              重做错题
            </button>
          )}
          {onNext && (
            <button className="btn btn-primary" onClick={onNext}>
              下一关
            </button>
          )}
          <button className="btn btn-secondary" onClick={onHome}>
            返回
          </button>
        </div>
      </div>
    </div>
  );
}
