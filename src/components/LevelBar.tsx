import { levelFor } from "../engine";
import { XP_PER_LEVEL } from "../config";
import { useLocale } from "../i18n/LocaleProvider";
import { formatNumber } from "../i18n/format";

export function LevelBar({ xp }: { xp: number }) {
  const { locale, t } = useLocale();
  const level = levelFor(xp);
  const inLevel = xp % XP_PER_LEVEL;
  return (
    <div className="level-bar">
      <span className="level-num">
        {t("level.current", { level: formatNumber(locale, level) })}
      </span>
      <span className="level-track" aria-hidden="true">
        <span
          className="level-fill"
          style={{ width: `${(inLevel / XP_PER_LEVEL) * 100}%` }}
        />
      </span>
      <span className="level-xp">
        <span className="level-xp-label">{t("level.xpLabel")}</span>
        {t("level.xpValue", {
          current: formatNumber(locale, inLevel),
          total: formatNumber(locale, XP_PER_LEVEL),
        })}
      </span>
    </div>
  );
}
