import { useState } from "react";
import type { Progress } from "../types";
import { shiftDate, today } from "../storage";
import { levelFor, streakFor, studyTotals } from "../engine";
import { useLocale } from "../i18n/LocaleProvider";
import {
  formatUserError,
  normalizeUserFacingError,
  type UserFacingError,
} from "../i18n/errors";
import {
  formatDate,
  formatNumber,
  formatStudyDuration,
} from "../i18n/format";
import type { ShareResult } from "../share/shareStats";

type ShareStatus = "idle" | ShareResult["status"];

export function StatsView({
  progress,
  onShare,
}: {
  progress: Progress;
  onShare?: () => Promise<ShareResult>;
}) {
  const { locale, t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ShareStatus>("idle");
  // 只保存原始结构化错误，主提示与详情在渲染时按当前语言生成。
  const [shareError, setShareError] = useState<UserFacingError | null>(null);

  const handleShare = async () => {
    if (!onShare || busy) return;
    setBusy(true);
    setStatus("idle");
    setShareError(null);
    try {
      const result = await onShare();
      setStatus(result.status);
      if (result.status === "error") {
        setShareError(
          result.error ?? normalizeUserFacingError(result.message)
        );
      }
    } catch (error) {
      setStatus("error");
      setShareError(normalizeUserFacingError(error));
    } finally {
      setBusy(false);
    }
  };

  const formattedError =
    status === "error" && shareError
      ? formatUserError(shareError, locale)
      : null;

  const statusMessage =
    status === "shared"
      ? t("stats.shareOpened")
      : status === "downloaded"
        ? t("stats.shareDownloaded")
        : status === "cancelled"
          ? t("stats.shareCancelled")
          : status === "error"
            ? (formattedError?.message ?? t("stats.retry"))
            : "";

  const date = today();
  const last7 = Array.from({ length: 7 }, (_, i) => shiftDate(date, -(6 - i)));
  const max = Math.max(...last7.map((d) => progress.days[d]?.xp ?? 0), 1);
  const study7 = last7.map((d) => {
    const day = progress.days[d];
    const read = typeof day?.readSeconds === "number" ? day.readSeconds : 0;
    const practice = typeof day?.practiceSeconds === "number" ? day.practiceSeconds : 0;
    return { read, practice, total: read + practice };
  });
  const maxStudy = Math.max(...study7.map((s) => s.total), 1);
  const totals = studyTotals(progress.days);
  const dayLabel = (d: string) =>
    formatDate(locale, `${d}T00:00:00`, { month: "2-digit", day: "2-digit" });

  return (
    <div className="stats">
      <div className="stats-top">
        <div className="stat-box">
          <div className="stat-num">{formatNumber(locale, progress.xp)}</div>
          <div className="stat-label">{t("stats.xp")}</div>
        </div>
        <div className="stat-box">
          <div className="stat-num">{formatNumber(locale, levelFor(progress.xp))}</div>
          <div className="stat-label">{t("stats.level")}</div>
        </div>
        <div className="stat-box">
          <div className="stat-num">
            {formatNumber(locale, streakFor(progress.days, progress.dailyGoal, date))}
          </div>
          <div className="stat-label">{t("stats.streak")}</div>
        </div>
      </div>

      <div className="stats-title">{t("stats.recent7")}</div>
      <div className="bars">
        {last7.map((d) => {
          const xp = progress.days[d]?.xp ?? 0;
          const isToday = d === date;
          return (
            <div key={d} className="bar-col">
              <div className="bar-num">{xp > 0 ? formatNumber(locale, xp) : ""}</div>
              <div className="bar-track">
                <div
                  className={`bar-fill ${isToday ? "bar-today" : ""}`}
                  style={{ height: `${(xp / max) * 100}%` }}
                />
              </div>
              <div className={`bar-label ${isToday ? "bar-label-today" : ""}`}>
                {dayLabel(d)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="stats-title">{t("stats.studyRecent7")}</div>
      <div className="bars study-bars">
        {last7.map((d, i) => {
          const { read, practice, total } = study7[i];
          const isToday = d === date;
          const minutes = Math.round(total / 60);
          return (
            <div key={d} className="bar-col">
              <div className="bar-num">
                {minutes > 0 ? formatNumber(locale, minutes) : ""}
              </div>
              <div className="bar-track">
                <div
                  className="study-seg study-practice"
                  style={{ height: `${(practice / maxStudy) * 100}%` }}
                />
                <div
                  className="study-seg study-read"
                  style={{ height: `${(read / maxStudy) * 100}%` }}
                />
              </div>
              <div className={`bar-label ${isToday ? "bar-label-today" : ""}`}>
                {dayLabel(d)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="study-legend">
        <span className="study-legend-item">
          <span className="study-dot study-read" />
          {t("stats.read")}
        </span>
        <span className="study-legend-item">
          <span className="study-dot study-practice" />
          {t("stats.practice")}
        </span>
      </div>

      <div className="study-total">
        {t("stats.total", {
          total: formatStudyDuration(locale, totals.total),
          read: formatStudyDuration(locale, totals.read),
          practice: formatStudyDuration(locale, totals.practice),
        })}
      </div>

      {onShare && (
        <div className="stats-share">
          <button
            className="btn btn-small btn-primary stats-share-btn"
            aria-label={t("stats.shareAria")}
            aria-busy={busy}
            disabled={busy}
            onClick={handleShare}
          >
            <span aria-hidden="true">⬆</span>{" "}
            {busy
              ? t("stats.shareBusy")
              : status === "error"
                ? t("stats.shareError")
                : t("stats.share")}
          </button>
          {statusMessage && (
            <div
              className={`stats-share-status${status === "error" ? " is-error" : ""}`}
              role="status"
              aria-live="polite"
            >
              <span>{statusMessage}</span>
              {formattedError?.diagnostic && (
                <details className="stats-share-details">
                  <summary>{t("errors.details")}</summary>
                  <span>{formattedError.diagnostic}</span>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
