import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { vi } from "vitest";

vi.mock("virtual:fge-content", async () => {
  const { syntheticChapter } = await import("./test/fixtures");
  return { CHAPTERS: [syntheticChapter] };
});

import App from "./App";
import { STORAGE_KEY } from "./config";
import { THEME_KEY } from "./theme";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type ChangeListener = (event: MediaQueryListEvent) => void;

let dark = false;
const listeners = new Set<ChangeListener>();

function installMatchMedia() {
  const mql = {
    get matches() {
      return dark;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (type: string, listener: ChangeListener) => {
      if (type === "change") listeners.add(listener);
    },
    removeEventListener: (type: string, listener: ChangeListener) => {
      if (type === "change") listeners.delete(listener);
    },
    addListener: (listener: ChangeListener) => listeners.add(listener),
    removeListener: (listener: ChangeListener) => listeners.delete(listener),
    dispatchEvent: () => true,
  };
  vi.stubGlobal("matchMedia", vi.fn(() => mql));
}

function setSystemDark(next: boolean) {
  dark = next;
  for (const listener of [...listeners]) {
    listener({ matches: dark } as MediaQueryListEvent);
  }
}

let container: HTMLDivElement;
let root: Root;

const $$ = (sel: string) => [...container.querySelectorAll(sel)];

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function openSettings() {
  const button = $$(".bottom-nav button").find((b) => b.textContent === "设置");
  expect(button).toBeDefined();
  click(button!);
}

function themeRadios() {
  return $$('[role="radio"]') as HTMLButtonElement[];
}

function radioByText(text: string) {
  const radio = themeRadios().find((b) => b.textContent === text);
  expect(radio).toBeDefined();
  return radio!;
}

beforeEach(() => {
  localStorage.clear();
  dark = false;
  listeners.clear();
  installMatchMedia();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
});

test("设置页外观:radiogroup 三段按钮,切换深色立即应用且不写学习进度", () => {
  act(() => root.render(<App />));
  openSettings();

  const group = container.querySelector('[role="radiogroup"][aria-label="外观"]');
  expect(group).not.toBeNull();
  expect(themeRadios().map((b) => b.textContent)).toEqual(["浅色", "跟随系统", "深色"]);
  expect(radioByText("跟随系统").getAttribute("aria-checked")).toBe("true");

  click(radioByText("深色"));

  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  expect(radioByText("深色").getAttribute("aria-checked")).toBe("true");
  expect(radioByText("跟随系统").getAttribute("aria-checked")).toBe("false");
  expect(radioByText("浅色").getAttribute("aria-checked")).toBe("false");
  expect(radioByText("深色").className).toContain("selected");
  expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
});

test("跟随系统:系统偏好变化后实时应用,浅色/深色不随系统变化", () => {
  act(() => root.render(<App />));
  openSettings();

  click(radioByText("跟随系统"));
  expect(localStorage.getItem(THEME_KEY)).toBe("system");
  expect(document.documentElement.dataset.theme).toBe("light");

  act(() => setSystemDark(true));
  expect(document.documentElement.dataset.theme).toBe("dark");

  act(() => setSystemDark(false));
  expect(document.documentElement.dataset.theme).toBe("light");

  click(radioByText("浅色"));
  act(() => setSystemDark(true));
  expect(document.documentElement.dataset.theme).toBe("light");

  click(radioByText("深色"));
  act(() => setSystemDark(false));
  expect(document.documentElement.dataset.theme).toBe("dark");
});

test("重新渲染 App 后保持已保存的主题选择", () => {
  act(() => root.render(<App />));
  openSettings();
  click(radioByText("深色"));
  expect(document.documentElement.dataset.theme).toBe("dark");

  act(() => root.unmount());
  container.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<App />));

  expect(document.documentElement.dataset.theme).toBe("dark");
  openSettings();
  expect(radioByText("深色").getAttribute("aria-checked")).toBe("true");
});
