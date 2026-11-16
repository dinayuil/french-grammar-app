import { applyDesktopWindowTitle } from "../native/desktop";
import { t } from "./messages";
import { UI_LOCALES, type UiLocale } from "./types";

/** 独立的语言偏好键；不进入 Progress、备份或 WebDAV。 */
export const LOCALE_STORAGE_KEY = "fge:ui-locale:v1";

export const DEFAULT_UI_LOCALE: UiLocale = "zh-CN";

/** 存储中的值只有精确匹配规范语言标识才有效；`fr-FR` 等不回退成 `fr`。 */
export function isUiLocale(value: unknown): value is UiLocale {
  return (
    typeof value === "string" &&
    (UI_LOCALES as readonly string[]).includes(value)
  );
}

/**
 * 读取用户保存的语言偏好。
 *
 * 这里返回原偏好，不根据当前版本支持列表裁剪：法语版暂时不可用时，调用方
 * 用 `resolveLocale` 临时回退，但本地偏好保持不变。缺省、坏值和存储异常都
 * 视为中文。
 */
export function loadLocaleChoice(): UiLocale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isUiLocale(raw) ? raw : DEFAULT_UI_LOCALE;
  } catch {
    return DEFAULT_UI_LOCALE;
  }
}

/** 保存语言偏好；隐私模式或配额异常不能阻止本次会话切换。 */
export function saveLocaleChoice(choice: UiLocale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, choice);
  } catch {
    // 存储不可用：Provider 仍会更新 React 状态，本次会话照常切换。
  }
}

/** 当前版本支持所选语言时直接使用，否则临时回退中文，不修改保存值。 */
export function resolveLocale(
  choice: UiLocale,
  supported: readonly UiLocale[],
): UiLocale {
  return supported.includes(choice) ? choice : DEFAULT_UI_LOCALE;
}

/**
 * 运行时窗口标题：公开版使用公共应用名；内部版保留原有版本后缀并按语言
 * 本地化。`document.title` 仍保持公共品牌语义，不随内部版后缀改变。
 */
export function windowTitleForLocale(
  locale: UiLocale,
  edition: "public" | "internal" = __FGE_EDITION__,
): string {
  return edition === "internal"
    ? t(locale, "app.internalTitle")
    : t(locale, "app.title");
}

/** 更新文档语言与页面标题；应用标题来自同一份类型化文案目录。 */
export function applyLocale(locale: UiLocale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  // 保留现有 document.title 语义：始终是公共应用名，内部版后缀只上原生窗口。
  document.title = t(locale, "app.title");
  void applyDesktopWindowTitle(windowTitleForLocale(locale));
}
