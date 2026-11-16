import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { vi } from "vitest";
import { STORAGE_KEY } from "./config";
import { LOCALE_STORAGE_KEY } from "./i18n/locale";
import { DEFAULT_PROGRESS } from "./storage";

const contentState = vi.hoisted(() => ({
  supportedLocales: ["zh-CN", "fr"] as Array<"zh-CN" | "fr">,
}));

vi.mock("virtual:fge-content", async () => {
  const { syntheticChapter } = await import("./test/fixtures");
  return {
    CHAPTERS: [syntheticChapter],
    SUPPORTED_LOCALES: contentState.supportedLocales,
  };
});

import App from "./App";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function setSupportedLocales(...locales: Array<"zh-CN" | "fr">) {
  contentState.supportedLocales.splice(
    0,
    contentState.supportedLocales.length,
    ...locales
  );
}

function mountApp() {
  act(() => {
    root.render(<App />);
  });
}

function unmountApp() {
  act(() => root.unmount());
  container.remove();
}

function click(el: Element | null | undefined) {
  if (!el) throw new Error("要点击的元素不存在");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function nav(): HTMLElement {
  const el = container.querySelector<HTMLElement>(".bottom-nav");
  if (!el) throw new Error("主导航不存在");
  return el;
}

function navButtons(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>(".bottom-nav .nav-item")];
}

function navLabels(): string[] {
  return navButtons().map((button) => button.textContent?.trim() ?? "");
}

function navByLabel(label: string): HTMLButtonElement {
  const button = navButtons().find((item) => item.textContent?.trim() === label);
  if (!button) throw new Error(`导航项不存在: ${label}`);
  return button;
}

function languageTrigger(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(".language-menu__trigger");
}

function openLanguageMenu(): HTMLElement {
  click(languageTrigger());
  const menu = container.querySelector<HTMLElement>('[role="listbox"]');
  if (!menu) throw new Error("语言菜单未打开");
  return menu;
}

function chooseLanguage(name: string) {
  const option = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => item.textContent?.trim() === name
  );
  if (!option) throw new Error(`语言选项不存在: ${name}`);
  click(option);
}

beforeEach(() => {
  localStorage.clear();
  setSupportedLocales("zh-CN", "fr");
  document.documentElement.lang = "zh-CN";
  document.title = "法语语法练习";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  document.documentElement.lang = "zh-CN";
  document.title = "法语语法练习";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
});

test("切换语言停留在当前视图并保留视图内状态，不写 Progress、不重复保存偏好", () => {
  const progressRaw = JSON.stringify({ ...DEFAULT_PROGRESS, xp: 37, dailyGoal: 25 });
  localStorage.setItem(STORAGE_KEY, progressRaw);
  const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

  mountApp();

  expect(nav().getAttribute("aria-label")).toBe("主导航");
  expect(navLabels()).toEqual(["练习", "讲解", "统计", "设置"]);
  expect(nav().lastElementChild?.classList.contains("language-menu")).toBe(true);
  expect(nav().lastElementChild?.classList.contains("nav-item")).toBe(false);
  expect(languageTrigger()).not.toBeNull();
  expect(languageTrigger()!.getAttribute("aria-label")).toContain("Français");

  click(navByLabel("设置"));
  const settings = container.querySelector<HTMLElement>(".settings");
  expect(settings).not.toBeNull();
  click(
    [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "清空进度"
    )
  );
  expect(settings!.textContent).toContain("确定清空全部进度");

  openLanguageMenu();
  chooseLanguage("Français");

  expect(navLabels()).toEqual(["Exercices", "Cours", "Statistiques", "Réglages"]);
  expect(nav().getAttribute("aria-label")).toBe("Navigation principale");
  expect(navByLabel("Réglages").getAttribute("aria-current")).toBe("page");
  expect(container.querySelector(".settings")).toBe(settings);
  expect(settings!.textContent).toContain("Effacer toute la progression (série, XP, niveaux) ?");
  expect(settings!.textContent).not.toContain("确定清空全部进度");
  expect(document.documentElement.lang).toBe("fr");
  expect(document.title).toBe("Exercices de grammaire française");
  expect(languageTrigger()!.getAttribute("aria-label")).toContain("简体中文");
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("fr");
  expect(localStorage.getItem(STORAGE_KEY)).toBe(progressRaw);
  expect(Object.keys(JSON.parse(progressRaw) as object)).not.toContain("locale");

  const localeWrites = setItemSpy.mock.calls.filter(
    ([key]) => key === LOCALE_STORAGE_KEY
  );
  expect(localeWrites).toHaveLength(1);
  const progressWrites = setItemSpy.mock.calls.filter(([key]) => key === STORAGE_KEY);
  expect(progressWrites).toHaveLength(0);
});

test("已保存法语时直接用法语界面，切回中文只更新导航与偏好", () => {
  const progressRaw = JSON.stringify({ ...DEFAULT_PROGRESS, xp: 12 });
  localStorage.setItem(STORAGE_KEY, progressRaw);
  localStorage.setItem(LOCALE_STORAGE_KEY, "fr");

  mountApp();

  expect(navLabels()).toEqual(["Exercices", "Cours", "Statistiques", "Réglages"]);
  expect(nav().getAttribute("aria-label")).toBe("Navigation principale");
  expect(document.documentElement.lang).toBe("fr");
  expect(document.title).toBe("Exercices de grammaire française");
  expect(languageTrigger()!.getAttribute("aria-label")).toContain("简体中文");

  openLanguageMenu();
  chooseLanguage("简体中文");

  expect(navLabels()).toEqual(["练习", "讲解", "统计", "设置"]);
  expect(nav().getAttribute("aria-label")).toBe("主导航");
  expect(document.documentElement.lang).toBe("zh-CN");
  expect(document.title).toBe("法语语法练习");
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-CN");
  expect(localStorage.getItem(STORAGE_KEY)).toBe(progressRaw);
});

test("仅中文版隐藏语言工具并保留法语偏好，完整语言包恢复后重新用法语", () => {
  setSupportedLocales("zh-CN");
  localStorage.setItem(LOCALE_STORAGE_KEY, "fr");

  mountApp();

  expect(languageTrigger()).toBeNull();
  expect(container.querySelector('[role="listbox"]')).toBeNull();
  expect(navLabels()).toEqual(["练习", "讲解", "统计", "设置"]);
  expect(document.documentElement.lang).toBe("zh-CN");
  expect(document.title).toBe("法语语法练习");
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("fr");

  unmountApp();
  setSupportedLocales("zh-CN", "fr");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  mountApp();

  expect(navLabels()).toEqual(["Exercices", "Cours", "Statistiques", "Réglages"]);
  expect(languageTrigger()).not.toBeNull();
  expect(languageTrigger()!.getAttribute("aria-label")).toContain("简体中文");
  expect(document.documentElement.lang).toBe("fr");
  expect(document.title).toBe("Exercices de grammaire française");
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("fr");
});
