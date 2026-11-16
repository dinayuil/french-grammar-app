import { formatStudyDuration as formatCanonicalStudyDuration } from "./i18n/format";
import type { UiLocale } from "./i18n/types";

/**
 * 学习时长显示规则由 `i18n/format.ts` 的唯一实现负责（分钟四舍五入、
 * 满一小时显示小时与剩余分钟、负数/非有限值按 0）。这里保留旧的
 * `(seconds, locale?)` 参数顺序，供统计页与分享卡平滑迁移。
 */
export function formatStudyDuration(
  seconds: number,
  locale: UiLocale = "zh-CN"
): string {
  return formatCanonicalStudyDuration(locale, seconds);
}
