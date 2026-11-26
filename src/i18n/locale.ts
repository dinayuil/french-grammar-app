import { applyDesktopWindowTitle } from "../native/desktop";
import { t } from "./messages";
import { UI_LOCALES, type UiLocale } from "./types";

/** 独立的语言偏好键；不进入 Progress、备份或 WebDAV。 */
export const LOCALE_STORAGE_KEY = "fge:ui-locale:v1";

export const DEFAULT_UI_LOCALE: UiLocale = "zh-CN";
export type LocaleChoice = UiLocale | "system";

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
 * 保留原偏好供语言包恢复后使用。缺省、坏值和存储异常时跟随系统。
 */
export function loadLocaleChoice(): LocaleChoice {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isUiLocale(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

/** 保存语言偏好；隐私模式或配额异常不能阻止本次会话切换。 */
export function saveLocaleChoice(choice: LocaleChoice): void {
  try {
    if (choice === "system") {
      localStorage.removeItem(LOCALE_STORAGE_KEY);
    } else {
      localStorage.setItem(LOCALE_STORAGE_KEY, choice);
    }
  } catch {
    // 存储不可用：Provider 仍会更新 React 状态，本次会话照常切换。
  }
}

export function getSystemLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

export function resolveLocale(
  choice: LocaleChoice,
  supported: readonly UiLocale[],
  systemLanguages: readonly string[],
): UiLocale {
  if (choice === "system") {
    for (const language of systemLanguages) {
      const tag = language.toLowerCase();
      const exact = supported.find((locale) => locale.toLowerCase() === tag);
      if (exact) return exact;

      const base = tag.split("-")[0];
      const match = supported.find((locale) => locale.toLowerCase().split("-")[0] === base);
      if (match) return match;
    }
  } else if (supported.includes(choice)) {
    return choice;
  }

  // 英语通过完整性校验并列入当前版本时，自动成为回退语言。
  return supported.find((locale: string) => locale === "en") ?? DEFAULT_UI_LOCALE;
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
