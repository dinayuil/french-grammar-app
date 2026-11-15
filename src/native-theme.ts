import { Capacitor, registerPlugin } from "@capacitor/core";
import { applyHarmonyTheme, isHarmonyPlatform } from "./native/platform";

export interface AppThemePlugin {
  apply(options: { mode: "light" | "dark" }): Promise<void>;
}

let appTheme: AppThemePlugin | undefined;

/** 首次调用时才注册,避免模块加载即触碰 Capacitor。 */
function getAppTheme(): AppThemePlugin {
  appTheme ??= registerPlugin<AppThemePlugin>("AppTheme");
  return appTheme;
}

/** 原生平台把系统栏 / window 背景同步到强制主题;Web 上 no-op。 */
export function applyNativeTheme(mode: "light" | "dark"): void {
  // 鸿蒙桥存在即优先走鸿蒙,不注册也不触碰 Capacitor 平台判断。
  if (isHarmonyPlatform()) {
    applyHarmonyTheme(mode);
    return;
  }
  const plugin = getAppTheme();
  if (!Capacitor.isNativePlatform()) return;
  void plugin.apply({ mode }).catch(() => {
    // 原生不可用时,WebView 主题仍由 applyTheme 生效。
  });
}
