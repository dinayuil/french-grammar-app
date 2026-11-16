import { STORAGE_KEY } from "../config";
import { DEFAULT_PROGRESS } from "../storage";

const coreMock = vi.hoisted(() => ({
  isTauri: vi.fn(),
  invoke: vi.fn(),
}));
const windowMock = vi.hoisted(() => ({
  getCurrentWindow: vi.fn(),
  setTitle: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => coreMock);
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: windowMock.getCurrentWindow,
}));

import { formatDate, formatNumber, formatStudyDuration } from "./format";
import {
  applyLocale,
  loadLocaleChoice,
  LOCALE_STORAGE_KEY,
  resolveLocale,
  saveLocaleChoice,
  windowTitleForLocale,
} from "./locale";

const SUPPORTED = ["zh-CN", "fr"] as const;

/**
 * 冻结的旧 helper 语义（baseline `src/formatStudyDuration.ts`）。
 *
 * 旧文件现在已委托给 `i18n/format.ts`，直接 import 会变成新实现与自身比较；
 * 这里保留旧公式作为独立 oracle，配合下方 literal 表验证中文口径未变。
 */
function legacyChineseDuration(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.round(safeSeconds / 60);
  if (minutes < 60) return `${minutes} 分`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  coreMock.isTauri.mockReset().mockReturnValue(false);
  coreMock.invoke.mockReset();
  windowMock.getCurrentWindow.mockReset().mockReturnValue({
    setTitle: windowMock.setTitle,
  });
  windowMock.setTitle.mockReset().mockResolvedValue(undefined);
  document.documentElement.lang = "zh-CN";
  document.title = "法语语法练习";
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.lang = "zh-CN";
  document.title = "法语语法练习";
});

test("语言偏好使用独立的精确存储键", () => {
  expect(LOCALE_STORAGE_KEY).toBe("fge:ui-locale:v1");
});

test("无存储、坏值和未知语言默认中文", () => {
  expect(loadLocaleChoice()).toBe("zh-CN");

  for (const raw of ["en", "fr-FR", "", "null", "zh"]) {
    localStorage.setItem(LOCALE_STORAGE_KEY, raw);
    expect(loadLocaleChoice()).toBe("zh-CN");
  }
});

test("已存 fr 即使当前版本不支持也会被读取", () => {
  localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
  expect(loadLocaleChoice()).toBe("fr");
});

test("resolveLocale 在当前支持列表不足时临时回退中文", () => {
  expect(resolveLocale("fr", SUPPORTED)).toBe("fr");
  expect(resolveLocale("zh-CN", SUPPORTED)).toBe("zh-CN");
  expect(resolveLocale("fr", ["zh-CN"])).toBe("zh-CN");
});

test("临时回退不覆写已保存偏好，完整语言包恢复后重新生效", () => {
  saveLocaleChoice("fr");
  expect(resolveLocale(loadLocaleChoice(), ["zh-CN"])).toBe("zh-CN");
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("fr");

  expect(resolveLocale(loadLocaleChoice(), SUPPORTED)).toBe("fr");
});

test("读取或保存存储抛异常都不外泄", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });
  expect(loadLocaleChoice()).toBe("zh-CN");
  vi.restoreAllMocks();

  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });
  expect(() => saveLocaleChoice("fr")).not.toThrow();
});

test("applyLocale 更新 html lang 与应用标题", () => {
  applyLocale("fr");
  expect(document.documentElement.lang).toBe("fr");
  expect(document.title).toBe("Exercices de grammaire française");

  applyLocale("zh-CN");
  expect(document.documentElement.lang).toBe("zh-CN");
  expect(document.title).toBe("法语语法练习");
});

test("桌面端原生窗口标题跟随 applyLocale，网页端不调用原生窗口", async () => {
  coreMock.isTauri.mockReturnValue(true);

  applyLocale("zh-CN");
  await vi.waitFor(() => {
    expect(windowMock.setTitle).toHaveBeenLastCalledWith(
      __FGE_EDITION__ === "internal" ? "法语语法练习·内部版" : "法语语法练习",
    );
  });

  applyLocale("fr");
  await vi.waitFor(() => {
    expect(windowMock.setTitle).toHaveBeenLastCalledWith(
      __FGE_EDITION__ === "internal"
        ? "Exercices de grammaire française · version interne"
        : "Exercices de grammaire française",
    );
  });
  expect(document.documentElement.lang).toBe("fr");
  expect(document.title).toBe("Exercices de grammaire française");

  coreMock.isTauri.mockReturnValue(false);
  windowMock.setTitle.mockClear();
  applyLocale("zh-CN");
  await Promise.resolve();
  expect(windowMock.setTitle).not.toHaveBeenCalled();
});

test("已保存 fr 偏好在桌面端恢复法语原生窗口标题", async () => {
  coreMock.isTauri.mockReturnValue(true);
  localStorage.setItem(LOCALE_STORAGE_KEY, "fr");

  applyLocale(loadLocaleChoice());

  await vi.waitFor(() => {
    expect(windowMock.setTitle).toHaveBeenLastCalledWith(
      __FGE_EDITION__ === "internal"
        ? "Exercices de grammaire française · version interne"
        : "Exercices de grammaire française",
    );
  });
});

test("内部版原生窗口标题保留本地化后缀", () => {
  expect(windowTitleForLocale("zh-CN", "public")).toBe("法语语法练习");
  expect(windowTitleForLocale("fr", "public")).toBe(
    "Exercices de grammaire française",
  );
  expect(windowTitleForLocale("zh-CN", "internal")).toBe(
    "法语语法练习·内部版",
  );
  expect(windowTitleForLocale("fr", "internal")).toBe(
    "Exercices de grammaire française · version interne",
  );
});

test("语言偏好不写入 Progress，也不改变进度序列化", () => {
  const progress = { ...DEFAULT_PROGRESS, xp: 42 };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));

  saveLocaleChoice("fr");

  expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(progress));
  expect(JSON.stringify(DEFAULT_PROGRESS)).not.toContain("ui-locale");
  expect(Object.keys(DEFAULT_PROGRESS)).not.toContain("locale");
  expect(Object.keys(progress)).not.toContain("locale");
});

test("日期与数字按 locale 使用 Intl 格式", () => {
  const date = new Date(Date.UTC(2026, 10, 16));

  expect(
    formatDate("zh-CN", date, {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }),
  ).toBe("2026年11月16日");
  expect(
    formatDate("fr", date, {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    }),
  ).toBe("16 novembre 2026");

  expect(formatNumber("zh-CN", 1234.5)).toBe("1,234.5");
  expect(formatNumber("fr", 1234.5)).toMatch(/^1\s234,5$/);
});

test("学习时长保留原中文口径并与旧 helper 完全一致", () => {
  // 预期值来自旧 helper 的语义，而不是新实现的自比较。
  const cases: ReadonlyArray<{
    seconds: number;
    zh: string;
    fr: string;
  }> = [
    { seconds: 0, zh: "0 分", fr: "0 min" },
    { seconds: 90, zh: "2 分", fr: "2 min" },
    { seconds: 3599, zh: "1 小时", fr: "1 h" },
    { seconds: 3600, zh: "1 小时", fr: "1 h" },
    { seconds: 3660, zh: "1 小时 1 分", fr: "1 h 1 min" },
    { seconds: Number.NaN, zh: "0 分", fr: "0 min" },
    { seconds: -5, zh: "0 分", fr: "0 min" },
  ];

  for (const { seconds, zh, fr } of cases) {
    expect(formatStudyDuration("zh-CN", seconds)).toBe(zh);
    expect(formatStudyDuration("fr", seconds)).toBe(fr);
    expect(formatStudyDuration("zh-CN", seconds)).toBe(
      legacyChineseDuration(seconds),
    );
  }
});
