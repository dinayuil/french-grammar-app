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
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

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

function renderHome(openChapterId?: string) {
  act(() =>
    root.render(
      <HomeView
        chapters={CHAPTERS}
        progress={DEFAULT_PROGRESS}
        openChapterId={openChapterId}
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
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  if (originalScrollIntoView) {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  } else {
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
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
