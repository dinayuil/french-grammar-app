import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { LibraryView } from "./views/LibraryView";
import { ReaderView } from "./views/ReaderView";
import { CHAPTERS } from "./content";

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
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const c03 = CHAPTERS.find((ch) => ch.id === "pub-c03-adjectives");

describe.skipIf(__FGE_EDITION__ !== "public")("公开版 C03 讲解库目录验收", () => {
  test("34 张卡按 12 个单元分组", () => {
    if (!c03) throw new Error("C03 chapter not found");
    act(() =>
      root.render(
        <LibraryView
          chapters={[c03]}
          query=""
          onQueryChange={() => {}}
          onOpenCard={() => {}}
        />
      )
    );
    click($$(".library-chapter-toggle")[0]!);
    expect($$(".library-card-item").length).toBe(34);
    expect($$(".library-unit-title").length).toBe(12);
    expect($$(".library-unit-title")[0]!.textContent).toBe("第1单元");
  });

  test("C03 的 34 张卡在阅读器目录抽屉中完整列出并按单元分组", () => {
    if (!c03) throw new Error("C03 chapter not found");
    act(() =>
      root.render(
        <ReaderView
          chapter={c03}
          chapterNumber={3}
          onBack={() => {}}
          onPracticeChapter={() => {}}
        />
      )
    );
    click($$(".reader-toc-toggle")[0]!);
    expect($$(".reader-toc-item").length).toBe(34);
    expect($$(".reader-toc-unit-title").length).toBe(12);
    expect($$(".reader-toc-item.active")[0]!.textContent).toContain(
      c03.cards[0].title
    );
  });
});
