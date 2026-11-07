import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { vi, describe, expect, test, beforeEach, afterEach } from "vitest";

vi.mock("virtual:fge-content", async () => {
  const { libraryChapters } = await import("./test/fixtures");
  return { CHAPTERS: libraryChapters };
});

import App from "./App";
import { CHAPTERS } from "./content";
import { HomeView } from "./views/HomeView";
import { DEFAULT_PROGRESS } from "./storage";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const scrollIntoView = vi.fn();
const originalScrollIntoView = Element.prototype.scrollIntoView;

let container: HTMLDivElement;
let root: Root;
let scrollTo: ReturnType<typeof vi.spyOn>;

const $$ = (sel: string) => [...container.querySelectorAll(sel)];
const $ = (sel: string) => container.querySelector(sel);

function click(el: Element | null) {
  if (!el) throw new Error("element not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function renderHome(openChapterId?: string, openLessonId?: string) {
  act(() =>
    root.render(
      <HomeView
        chapters={CHAPTERS}
        progress={DEFAULT_PROGRESS}
        openChapterId={openChapterId}
        openLessonId={openLessonId}
        onOpenLesson={() => {}}
        onOpenCards={() => {}}
        onOpenReview={() => {}}
      />
    )
  );
}

beforeEach(() => {
  localStorage.clear();
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  if (originalScrollIntoView) {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  } else {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("阅读器「练习本章」滚动定位", () => {
  test("从第二章阅读器返回:展开第二章、滚动卡片并聚焦切换按钮", () => {
    act(() => root.render(<App />));

    const cardsButtons = $$(".btn-cards");
    expect(cardsButtons.length).toBe(2);
    click(cardsButtons[1]!);
    expect($$(".reader").length).toBe(1);

    click($(".reader-practice"));
    expect($$(".reader").length).toBe(0);

    const chapterCards = $$(".chapter-card");
    expect(chapterCards.length).toBe(2);
    const secondCard = chapterCards[1]!;
    expect(secondCard.querySelector(".lesson-list")).not.toBeNull();
    expect(chapterCards[0]!.querySelector(".lesson-list")).toBeNull();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(secondCard);
    expect(scrollIntoView.mock.calls[0]![0]).toMatchObject({
      block: "start",
      behavior: "smooth",
    });
    expect(document.activeElement).toBe(secondCard.querySelector(".chapter-toggle"));
  });

  test("缺失章节:回到页面顶部且不展开任何章节", () => {
    renderHome("missing");

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0 });
    expect($$(".lesson-list").length).toBe(0);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  test("未提供 openChapterId:不触发滚动回顶", () => {
    renderHome();

    expect(scrollTo).not.toHaveBeenCalled();
    expect($$(".lesson-list").length).toBe(0);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  test("prefers-reduced-motion: reduce 时使用瞬时滚动", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    );

    renderHome("lib-ch1");

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.calls[0]![0]).toMatchObject({
      block: "start",
      behavior: "auto",
    });
  });

  test("手动折叠再展开同一章不会再次滚动", () => {
    renderHome("lib-ch1");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    const firstCard = $$(".chapter-card")[0]!;
    const toggle = firstCard.querySelector(".chapter-toggle");
    expect(toggle).not.toBeNull();

    click(toggle);
    expect(firstCard.querySelector(".lesson-list")).toBeNull();

    click(toggle);
    expect(firstCard.querySelector(".lesson-list")).not.toBeNull();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe("练习结算返回首页定位", () => {
  test("展开并只滚动、聚焦刚做过的关卡,不滚动章节卡片", () => {
    renderHome("lib-ch1", "lib-ch1-l1");

    const card = $$(".chapter-card")[0]!;
    const item = card.querySelector(".lesson-item");
    expect(item).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(item);
    expect(scrollIntoView.mock.calls[0]![0]).toMatchObject({
      block: "center",
      behavior: "smooth",
    });
    expect(scrollIntoView.mock.instances).not.toContain(card);
    expect(document.activeElement).toBe(item);
    expect(document.activeElement).not.toBe(card.querySelector(".chapter-toggle"));
  });

  test("App:完成练习点「返回」后展开章节并定位到该关卡", () => {
    act(() => root.render(<App />));

    click($$(".chapter-toggle")[0]!);
    click($(".lesson-item"));
    expect($$(".lesson").length).toBe(1);

    // 合成讲解章只有一道单选题:选正确答案 → 检查 → 继续 → 结算。
    click($$(".option-btn")[0]!);
    click($$(".btn-wide")[0]!); // 检查
    click($$(".btn-wide")[0]!); // 继续
    expect(container.textContent).toContain("练习完成");

    const back = $$(".settlement-actions .btn-secondary").find((b) =>
      b.textContent?.includes("返回")
    );
    click(back!);

    const returnedCard = $$(".chapter-card")[0]!;
    const returnedItem = returnedCard.querySelector(".lesson-item");
    expect(returnedCard.querySelector(".lesson-list")).not.toBeNull();
    expect(returnedItem).not.toBeNull();
    expect(returnedItem!.textContent).toContain("★★★");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(returnedItem);
    expect(scrollIntoView.mock.calls[0]![0]).toMatchObject({
      block: "center",
      behavior: "smooth",
    });
    expect(document.activeElement).toBe(returnedItem);
  });

  test("重复渲染与手动折叠再展开不会重复滚动目标关卡", () => {
    renderHome("lib-ch1", "lib-ch1-l1");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // 同一目标重复渲染(例如进度更新)不会再次滚动。
    renderHome("lib-ch1", "lib-ch1-l1");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    const toggle = $(".chapter-toggle");
    click(toggle);
    expect($$(".lesson-list").length).toBe(0);
    click(toggle);
    expect($$(".lesson-list").length).toBe(1);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  test("目标关卡缺失时回退到章节卡片,之后出现仍可重试", () => {
    renderHome("lib-ch1", "missing-lesson");

    const card = $$(".chapter-card")[0]!;
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(card);
    expect(scrollIntoView.mock.calls[0]![0]).toMatchObject({ block: "start" });
    expect(document.activeElement).toBe(card.querySelector(".chapter-toggle"));

    scrollIntoView.mockClear();
    renderHome("lib-ch1", "lib-ch1-l1");
    const item = card.querySelector(".lesson-item");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(item);
    expect(document.activeElement).toBe(item);
  });

  test("底部「练习」从已展开的首页返回:收起章节并滚动到顶部", () => {
    act(() => root.render(<App />));

    // 先从讲解页「练习本章」回到已展开章节的首页。
    click($$(".btn-cards")[0]!);
    click($(".reader-practice"));
    expect($$(".lesson-list").length).toBe(1);
    scrollIntoView.mockClear();

    const practiceNav = $$(".bottom-nav button").find((b) => b.textContent === "练习");
    click(practiceNav!);

    // 章节收起(原有语义),同时窗口回到顶部,且不会再次滚动章节。
    expect($$(".lesson-list").length).toBe(0);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0 });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
