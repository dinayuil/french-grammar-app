import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { vi, describe, expect, test, beforeEach, afterEach } from "vitest";

vi.mock("virtual:fge-content", async () => {
  const { sectionedChapters } = await import("./test/sectionFixtures");
  return { CHAPTERS: sectionedChapters };
});

import App from "./App";
import { sectionedMap } from "./test/sectionFixtures";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const $$ = (sel: string) =>
  [...container.querySelectorAll(sel)] as HTMLElement[];

function click(el: Element | null | undefined) {
  if (!el) throw new Error("element not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function renderApp() {
  act(() => root.render(<App sectionMap={sectionedMap} />));
}

function openLibrary() {
  const nav = $$(".nav-item").find((el) => el.textContent === "讲解");
  click(nav);
}

function expandFirstChapter() {
  click($$(".library-chapter-toggle")[0]);
}

function openSection(index: number) {
  click($$(".library-section-start")[index]);
}

describe("阅读器小节间连续阅读", () => {
  test("一节读完后可直接进入下一节，并标明下一节标题", () => {
    renderApp();
    openLibrary();
    expandFirstChapter();
    openSection(0);

    expect($$(".reader-section-name")[0]!.textContent).toBe("主题一 · 基础");
    expect($$(".reader-counter")[0]!.textContent).toBe("1/2");
    click($$(".reader-next")[0]);
    expect($$(".reader-counter")[0]!.textContent).toBe("2/2");
    expect(($$(".reader-next")[0] as HTMLButtonElement).disabled).toBe(true);

    const nextSection = $$(".reader-section-next")[0];
    expect(nextSection).toBeDefined();
    expect(nextSection!.textContent).toContain("下一节");
    expect(nextSection!.textContent).toContain("主题二 · 进阶");
    expect(nextSection!.getAttribute("aria-label")).toContain("主题二 · 进阶");

    click(nextSection);
    expect($$(".reader-section-name")[0]!.textContent).toBe("主题二 · 进阶");
    expect($$(".reader-counter")[0]!.textContent).toBe("1/3");
    expect(container.textContent).toContain("主题二讲解一");
    expect(($$(".reader-next")[0] as HTMLButtonElement).disabled).toBe(false);
  });

  test("下一节首张卡可回到上一节最后一张，而不是只停在首页", () => {
    renderApp();
    openLibrary();
    expandFirstChapter();
    openSection(1);

    expect($$(".reader-section-name")[0]!.textContent).toBe("主题二 · 进阶");
    expect($$(".reader-counter")[0]!.textContent).toBe("1/3");
    expect(($$(".reader-prev")[0] as HTMLButtonElement).disabled).toBe(true);
    const previousSection = $$(".reader-section-prev")[0];
    expect(previousSection).toBeDefined();
    expect(previousSection!.textContent).toContain("上一节");
    expect(previousSection!.textContent).toContain("主题一 · 基础");

    click(previousSection);
    expect($$(".reader-section-name")[0]!.textContent).toBe("主题一 · 基础");
    expect($$(".reader-counter")[0]!.textContent).toBe("2/2");
    expect(container.textContent).toContain("主题一讲解二");
  });

  test("本章最后一节读完不出现跨章入口", () => {
    renderApp();
    openLibrary();
    expandFirstChapter();
    openSection(1);
    click($$(".reader-next")[0]);
    click($$(".reader-next")[0]);

    expect($$(".reader-counter")[0]!.textContent).toBe("3/3");
    expect(($$(".reader-next")[0] as HTMLButtonElement).disabled).toBe(true);
    expect($$(".reader-section-next").length).toBe(0);
    expect($$(".reader-section-prev").length).toBe(0);
    expect(container.textContent).not.toContain("整章回退专题");
  });

  test("跨节阅读后「练习本节」仍进入当前小节，不退回上一节", () => {
    renderApp();
    openLibrary();
    expandFirstChapter();
    openSection(0);
    click($$(".reader-next")[0]);
    click($$(".reader-section-next")[0]);

    expect($$(".reader-section-name")[0]!.textContent).toBe("主题二 · 进阶");
    click($$(".reader-practice")[0]);

    const sections = $$(".section-card:not(.section-comprehensive)");
    expect(sections[0]!.querySelector(".lesson-list")).not.toBeNull();
    expect(sections[1]!.querySelector(".lesson-list")).not.toBeNull();
    expect(document.activeElement).toBe(
      sections[1]!.querySelector(".section-info")
    );
    expect(sections[1]!.textContent).toContain("主题二练习一");
  });
});

describe("返回讲解库时保留目录状态", () => {
  test("从阅读器返回后，之前展开的章节仍然展开", () => {
    renderApp();
    openLibrary();
    expandFirstChapter();

    expect($$(".library-card-item").length).toBe(5);
    expect($$(".library-chapter")[0]!.classList.contains("is-open")).toBe(true);

    click($$(".library-card-item")[0]);
    expect($$(".reader").length).toBe(1);

    click($$(".reader-back")[0]);
    expect($$(".library").length).toBe(1);
    expect($$(".library-card-item").length).toBe(5);
    expect($$(".library-chapter")[0]!.classList.contains("is-open")).toBe(true);
    expect(
      $$(".library-chapter")[1]!
        .querySelector(".library-chapter-toggle")!
        .getAttribute("aria-expanded")
    ).toBe("false");
  });
});
