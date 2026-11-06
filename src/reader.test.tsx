import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { vi, describe, expect, test, beforeEach, afterEach } from "vitest";

vi.mock("virtual:fge-content", async () => {
  const { syntheticChapter } = await import("./test/fixtures");
  return { CHAPTERS: [syntheticChapter] };
});

import App from "./App";
import { CHAPTERS } from "./content";
import { ReaderView } from "./views/ReaderView";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const $$ = (sel: string) => [...container.querySelectorAll(sel)];

function click(el: Element | null) {
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

const chapter = CHAPTERS[0];

describe("ReaderView via App", () => {
  test("章节卡上的「讲解」按钮打开阅读器，可翻页、打开目录并返回", () => {
    act(() => root.render(<App />));
    click($$(".btn-cards")[0]!);
    expect($$(".reader").length).toBe(1);
    expect(container.textContent).toContain("第1章 · 合成测试章");
    expect(container.textContent).toContain(chapter.cards[0].title);
    expect($$(".reader-counter")[0]!.textContent).toBe("1/2");
    expect(($$(".reader-progress-fill")[0] as HTMLElement).style.width).toBe("50%");
    expect($$(".reader-next")[0]!.textContent).toContain("下一张");
    expect(container.textContent).not.toContain("完成");

    click($$(".reader-next")[0]!);
    expect($$(".reader-counter")[0]!.textContent).toBe("2/2");
    expect(($$(".reader-progress-fill")[0] as HTMLElement).style.width).toBe("100%");
    expect(($$(".reader-next")[0] as HTMLButtonElement).disabled).toBe(true);

    click($$(".reader-prev")[0]!);
    expect($$(".reader-counter")[0]!.textContent).toBe("1/2");

    click($$(".reader-toc-toggle")[0]!);
    expect($$(".reader-drawer").length).toBe(1);
    expect($$(".reader-toc-item").length).toBe(chapter.cards.length);
    expect($$(".reader-toc-item.active")[0]!.textContent).toContain(
      chapter.cards[0].title
    );

    click($$(".reader-toc-item")[1]!);
    expect($$(".reader-counter")[0]!.textContent).toBe("2/2");
    expect($$(".reader-drawer").length).toBe(0);

    click($$(".reader-back")[0]!);
    expect($$(".chapter-card").length).toBe(1);
  });

  test("点击「练习本章」回到首页并自动展开该章节", () => {
    act(() => root.render(<App />));
    click($$(".btn-cards")[0]!);
    click($$(".reader-practice")[0]!);
    expect($$(".reader").length).toBe(0);
    const firstChapter = $$(".chapter-card")[0]!;
    expect(firstChapter.querySelector(".lesson-list")).not.toBeNull();
    expect(firstChapter.querySelectorAll(".lesson-item").length).toBe(3);
  });
});

describe("ReaderView direct", () => {
  test("initialCardId 定位到第二张", () => {
    act(() =>
      root.render(
        <ReaderView
          chapter={chapter}
          chapterNumber={1}
          initialCardId={chapter.cards[1].id}
          onBack={() => {}}
          onPracticeChapter={() => {}}
        />
      )
    );
    expect($$(".reader").length).toBe(1);
    expect($$(".reader-counter")[0]!.textContent).toBe("2/2");
    expect(container.textContent).toContain(chapter.cards[1].title);
  });

  test("空 cards 显示「本章暂无讲解」且返回按钮可用", () => {
    const onBack = vi.fn();
    const emptyChapter = { ...chapter, cards: [] };
    act(() =>
      root.render(
        <ReaderView
          chapter={emptyChapter}
          chapterNumber={1}
          onBack={onBack}
          onPracticeChapter={() => {}}
        />
      )
    );
    expect($$(".reader-empty").length).toBe(1);
    expect(container.textContent).toContain("本章暂无讲解");
    expect($$(".reader-back").length).toBe(1);
    click($$(".reader-back")[0]!);
    expect(onBack).toHaveBeenCalled();
  });

  test("卡片正文按受限 HTML 渲染，不显示标签或 markdown", () => {
    const htmlChapter = {
      ...chapter,
      cards: [
        {
          id: "card-html",
          title: "标题",
          body: "<p>第一段</p><ul><li>le</li><li>la</li></ul>",
        },
      ],
    };
    act(() =>
      root.render(
        <ReaderView
          chapter={htmlChapter}
          chapterNumber={1}
          onBack={() => {}}
          onPracticeChapter={() => {}}
        />
      )
    );
    const body = container.querySelector(".card-body")!;
    expect(body.querySelector("ul")).not.toBeNull();
    expect(body.querySelectorAll("li").length).toBe(2);
    expect(body.textContent).not.toContain("<p>");
    expect(body.textContent).not.toContain("<li>");
    expect(body.textContent).not.toContain("**");
  });

  test("点击「练习本章」调用回调", () => {
    const onPracticeChapter = vi.fn();
    act(() =>
      root.render(
        <ReaderView
          chapter={chapter}
          chapterNumber={1}
          onBack={() => {}}
          onPracticeChapter={onPracticeChapter}
        />
      )
    );
    click($$(".reader-practice")[0]!);
    expect(onPracticeChapter).toHaveBeenCalled();
  });
});
