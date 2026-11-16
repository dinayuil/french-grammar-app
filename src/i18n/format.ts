import { t } from "./messages";
import type { UiLocale } from "./types";

/**
 * 按 locale 格式化日期。`options` 直接透传 `Intl.DateTimeFormat`；不传时使用
 * 该语言的中性默认格式。调用方需要固定时区时显式传 `timeZone`。
 */
export function formatDate(
  locale: UiLocale,
  value: Date | number | string,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(locale, options).format(date);
}

/** 按 locale 格式化数字；`options` 透传 `Intl.NumberFormat`。 */
export function formatNumber(
  locale: UiLocale,
  value: number,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/**
 * 学习时长显示规则（与现有中文 helper 完全一致）：不足一小时按四舍五入的
 * 分钟显示；满一小时后显示小时与剩余分钟；负数和非有限值按 0 处理。
 * 单位来自类型化目录，中文保持「2 分 / 1 小时 1 分」原口径。
 */
export function formatStudyDuration(locale: UiLocale, seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.round(safeSeconds / 60);
  if (minutes < 60) {
    return t(locale, "duration.minutes", { count: minutes });
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourText = t(locale, "duration.hours", { count: hours });
  return rest > 0
    ? `${hourText} ${t(locale, "duration.minutes", { count: rest })}`
    : hourText;
}
