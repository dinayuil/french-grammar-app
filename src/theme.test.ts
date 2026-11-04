import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  THEME_KEY,
  applyTheme,
  getSystemPrefersDark,
  loadThemeChoice,
  resolveTheme,
  saveThemeChoice,
  watchSystemTheme,
} from "./theme";

type ChangeListener = (event: MediaQueryListEvent) => void;

/** 可变的 matchMedia 桩:测试里手动切换系统偏好并派发 change。 */
function stubMatchMedia(initialDark: boolean) {
  const listeners = new Set<ChangeListener>();
  let matches = initialDark;
  const mql = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn((type: string, listener: ChangeListener) => {
      if (type === "change") listeners.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: ChangeListener) => {
      if (type === "change") listeners.delete(listener);
    }),
    addListener: vi.fn((listener: ChangeListener) => listeners.add(listener)),
    removeListener: vi.fn((listener: ChangeListener) => listeners.delete(listener)),
    dispatchEvent: vi.fn(() => true),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => mql));
  return {
    mql,
    setMatches(next: boolean) {
      matches = next;
    },
    fireChange() {
      for (const listener of [...listeners]) {
        listener({ matches } as MediaQueryListEvent);
      }
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  document.querySelector('meta[name="theme-color"]')?.remove();
  const meta = document.createElement("meta");
  meta.setAttribute("name", "theme-color");
  meta.setAttribute("content", "#ffffff");
  document.head.appendChild(meta);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.querySelector('meta[name="theme-color"]')?.remove();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
});

test("默认主题选择为 system", () => {
  expect(loadThemeChoice()).toBe("system");
});

test.each(["light", "dark", "system"] as const)("读取合法值 %s", (choice) => {
  localStorage.setItem(THEME_KEY, choice);
  expect(loadThemeChoice()).toBe(choice);
});

test("非法值回退 system", () => {
  localStorage.setItem(THEME_KEY, "neon");
  expect(loadThemeChoice()).toBe("system");
});

test("存储读取异常时回退 system 且不抛错", () => {
  const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });
  expect(loadThemeChoice()).toBe("system");
  spy.mockRestore();
});

test("saveThemeChoice 只写主题键", () => {
  localStorage.setItem("unrelated", "keep");
  saveThemeChoice("dark");
  expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  expect(localStorage.getItem("unrelated")).toBe("keep");
  expect(localStorage.length).toBe(2);
});

test("存储写入异常时 saveThemeChoice 不抛错", () => {
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });
  expect(() => saveThemeChoice("dark")).not.toThrow();
  spy.mockRestore();
});

test("resolveTheme 按选择与系统偏好解析", () => {
  expect(resolveTheme("system", true)).toBe("dark");
  expect(resolveTheme("system", false)).toBe("light");
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme("dark", false)).toBe("dark");
});

test("applyTheme dark 设置 data-theme、color-scheme 与 theme-color", () => {
  applyTheme("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.style.colorScheme).toBe("dark");
  expect(document.querySelector('meta[name="theme-color"]')!.getAttribute("content")).toBe(
    "#131f24"
  );
});

test("applyTheme light 设置 data-theme、color-scheme 与 theme-color", () => {
  applyTheme("light");
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(document.documentElement.style.colorScheme).toBe("light");
  expect(document.querySelector('meta[name="theme-color"]')!.getAttribute("content")).toBe(
    "#ffffff"
  );
});

test("matchMedia 不存在时 getSystemPrefersDark 返回 false", () => {
  expect(getSystemPrefersDark()).toBe(false);
});

test("getSystemPrefersDark 读取 matchMedia 的 matches", () => {
  const media = stubMatchMedia(true);
  expect(getSystemPrefersDark()).toBe(true);
  media.setMatches(false);
  expect(getSystemPrefersDark()).toBe(false);
});

test("watchSystemTheme 响应 change/focus/visibilitychange,清理后不再回调", () => {
  const media = stubMatchMedia(false);
  const onChange = vi.fn();
  const cleanup = watchSystemTheme(onChange);
  expect(media.mql.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

  media.fireChange();
  expect(onChange).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("focus"));
  expect(onChange).toHaveBeenCalledTimes(2);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(onChange).toHaveBeenCalledTimes(3);

  cleanup();
  expect(media.mql.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  media.fireChange();
  window.dispatchEvent(new Event("focus"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(onChange).toHaveBeenCalledTimes(3);
});

test("index.html 启动脚本与模块使用同一主题键并预设 data-theme", () => {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  expect(html).toContain(THEME_KEY);
  expect(html).toContain("data-theme");
  expect(html).toContain("document.documentElement");
  expect(html).toContain("name=\"color-scheme\"");
  expect(html).toContain("name=\"theme-color\"");
});
