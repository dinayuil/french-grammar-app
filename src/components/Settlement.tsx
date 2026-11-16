import type { Lesson } from "../types";
import { useLocale } from "../i18n/LocaleProvider";
import { formatNumber } from "../i18n/format";

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

export function Settlement({
  lesson,
  breakdown,
  xpGained,
  stars,
  wrongQids,
  streak,
  onRedo,
  onNext,
  onHome,
}: Props) {
  const { locale, t } = useLocale();
  const perfect = wrongQids.length === 0;
  const number = (value: number) => formatNumber(locale, value);

  return (
    <div className="lesson">
      <div className="settlement">
        <div className="settlement-stars">{"⭐".repeat(stars) || "🎯"}</div>
        <div className="settlement-title">
          {lesson.kind === "challenge"
            ? t("settlement.title.challenge")
            : t("settlement.title.lesson")}
        </div>
        <div className={stars === 3 ? "settlement-sub good" : "settlement-sub"}>
          {stars === 3
            ? t("settlement.perfect")
            : t("settlement.mistakes", { count: number(wrongQids.length) })}
        </div>

        <div className="xp-breakdown">
          <div className="xp-row">
            <span>{t("settlement.quizXp")}</span>
            <span className="xp-num">+{number(breakdown.quiz)}</span>
          </div>
          {breakdown.redo > 0 && (
            <div className="xp-row">
              <span>{t("settlement.redoXp")}</span>
              <span className="xp-num">+{number(breakdown.redo)}</span>
            </div>
          )}
          <div className="xp-row">
            <span>{t("settlement.lessonXp")}</span>
            <span className="xp-num">+{number(breakdown.lesson)}</span>
          </div>
          <div className="xp-row">
            <span>{t("settlement.perfectXp")}</span>
            <span className="xp-num">+{number(breakdown.perfect)}</span>
          </div>
          <div className="xp-row xp-total">
            <span>{t("settlement.totalXp")}</span>
            <span className="xp-num">+{number(xpGained)} XP</span>
          </div>
        </div>

        <div className="streak-line">
          🔥 {t("stats.streak")} <b>{number(streak)}</b>
        </div>
      </div>

      <div className="quiz-footer">
        <div className="row-actions settlement-actions">
          {!perfect && (
            <button className="btn btn-secondary" onClick={onRedo}>
              {t("settlement.redo")}
            </button>
          )}
          {onNext && (
            <button className="btn btn-primary" onClick={onNext}>
              {t("settlement.next")}
            </button>
          )}
          <button className="btn btn-secondary" onClick={onHome}>
            {t("common.back")}
          </button>
        </div>
      </div>
    </div>
  );
}
