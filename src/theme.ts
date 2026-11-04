export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "fge.theme.v1";

const VALID_CHOICES: readonly ThemeChoice[] = ["light", "dark", "system"];
const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#ffffff",
  dark: "#131f24",
};

function isThemeChoice(value: unknown): value is ThemeChoice {
  return VALID_CHOICES.includes(value as ThemeChoice);
}

/** 读取主题选择:任何存储异常或非法值都回退 system。 */
export function loadThemeChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return isThemeChoice(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

/** 保存主题选择;隐私模式等存储异常不抛错。 */
export function saveThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // 存储不可用:本次会话仍可通过 React 状态切换主题。
  }
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === "system") return prefersDark ? "dark" : "light";
  return choice;
}

/** 把解析后的主题写到 <html>、color-scheme 和 theme-color meta。 */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
}

/** 系统是否偏好深色;缺少 matchMedia 或查询异常时按浅色处理。 */
export function getSystemPrefersDark(): boolean {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/**
 * 监听系统深色偏好变化。
 *
 * `change` 是标准入口;focus/visibilitychange 是 Android WebView 未实时派发
 * 媒体查询事件时的兜底。返回清理函数。
 */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  let query: MediaQueryList;
  try {
    query = window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    // 某些 WebView/测试桩的 matchMedia 会抛错;监听失败不能阻止 App 挂载。
    return () => {};
  }
  const handler = () => onChange();

  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", handler);
  } else if (typeof query.addListener === "function") {
    query.addListener(handler);
  }
  window.addEventListener("focus", handler);
  document.addEventListener("visibilitychange", handler);

  return () => {
    if (typeof query.removeEventListener === "function") {
      query.removeEventListener("change", handler);
    } else if (typeof query.removeListener === "function") {
      query.removeListener(handler);
    }
    window.removeEventListener("focus", handler);
    document.removeEventListener("visibilitychange", handler);
  };
}
