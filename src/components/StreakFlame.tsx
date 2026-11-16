import { FlameIcon } from "./icons";
import { useLocale } from "../i18n/LocaleProvider";
import { formatNumber } from "../i18n/format";

export function StreakFlame({ count }: { count: number }) {
  const { locale, t } = useLocale();
  return (
    <div className={count > 0 ? "streak-flame" : "streak-flame streak-flame-zero"}>
      <span className="streak-badge" aria-hidden="true">
        <FlameIcon />
      </span>
      <span className="streak-copy">
        <span className="streak-count">{formatNumber(locale, count)}</span>
        <span className="streak-label">{t("streak.label")}</span>
      </span>
    </div>
  );
}
