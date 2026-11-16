import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { STORAGE_KEY } from "../config";
import { DEFAULT_PROGRESS } from "../storage";
import { LOCALE_STORAGE_KEY } from "./locale";
import { LocaleProvider, useLocale } from "./LocaleProvider";
import type { UiLocale } from "./types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useLocale> | undefined;

function Probe() {
  latest = useLocale();
  return (
    <div>
      <span data-testid="locale">{latest.locale}</span>
      <span data-testid="nav">{latest.t("nav.practice")}</span>
      <span data-testid="blank">{latest.t("question.blankHint", { count: 2 })}</span>
      <button type="button" onClick={() => latest!.setLocale("fr")}>
        to-fr
      </button>
      <button type="button" onClick={() => latest!.setLocale("zh-CN")}>
        to-zh
      </button>
    </div>
  );
}

function renderLocale(supportedLocales: readonly UiLocale[]) {
  act(() => {
    root.render(
      <LocaleProvider supportedLocales={supportedLocales}>
        <Probe />
      </LocaleProvider>,
    );
  });
}

function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  expect(button).toBeDefined();
  act(() => {
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  latest = undefined;
  document.documentElement.lang = "zh-CN";
  document.title = "法语语法练习";
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
});

test("默认中文，暴露支持列表并应用页面语言与标题", () => {
  renderLocale(["zh-CN", "fr"]);

  expect(latest!.locale).toBe("zh-CN");
  expect(latest!.supportedLocales).toEqual(["zh-CN", "fr"]);
  expect(container.textContent).toContain("练习");
  expect(container.textContent).toContain("第2空");
  expect(document.documentElement.lang).toBe("zh-CN");
  expect(document.title).toBe("法语语法练习");
});

test("已保存 fr 时直接恢复法语界面", () => {
  localStorage.setItem(LOCALE_STORAGE_KEY, "fr");

  renderLocale(["zh-CN", "fr"]);

  expect(latest!.locale).toBe("fr");
  expect(container.textContent).toContain("Exercices");
  expect(container.textContent).toContain("Blanc n° 2");
  expect(document.documentElement.lang).toBe("fr");
  expect(document.title).toBe("Exercices de grammaire française");
});

test("setLocale 更新界面并持久化，不写 Progress", () => {
  const progress = { ...DEFAULT_PROGRESS, xp: 42 };
  const progressRaw = JSON.stringify(progress);
  localStorage.setItem(STORAGE_KEY, progressRaw);
  renderLocale(["zh-CN", "fr"]);

  click("to-fr");

  expect(latest!.locale).toBe("fr");
  expect(latest!.t("nav.practice")).toBe("Exercices");
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("fr");
  expect(document.documentElement.lang).toBe("fr");
  expect(localStorage.getItem(STORAGE_KEY)).toBe(progressRaw);
  expect(Object.keys(JSON.parse(progressRaw) as object)).not.toContain("locale");

  click("to-zh");
  expect(latest!.locale).toBe("zh-CN");
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-CN");
});

test("仅中文版本临时回退但保留 fr 偏好，完整语言包恢复后重新生效", () => {
  localStorage.setItem(LOCALE_STORAGE_KEY, "fr");

  renderLocale(["zh-CN"]);

  expect(latest!.locale).toBe("zh-CN");
  expect(container.textContent).toContain("练习");
  expect(document.documentElement.lang).toBe("zh-CN");
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("fr");

  renderLocale(["zh-CN", "fr"]);

  expect(latest!.locale).toBe("fr");
  expect(container.textContent).toContain("Exercices");
  expect(document.documentElement.lang).toBe("fr");
});

test("非法持久化值回退中文", () => {
  localStorage.setItem(LOCALE_STORAGE_KEY, "en");

  renderLocale(["zh-CN", "fr"]);

  expect(latest!.locale).toBe("zh-CN");
  expect(document.documentElement.lang).toBe("zh-CN");
});

test("存储写入异常时本次会话仍能切换语言", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });
  renderLocale(["zh-CN", "fr"]);

  expect(() => click("to-fr")).not.toThrow();

  expect(latest!.locale).toBe("fr");
  expect(container.textContent).toContain("Exercices");
  expect(document.documentElement.lang).toBe("fr");
  expect(document.title).toBe("Exercices de grammaire française");
});
