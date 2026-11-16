import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { CHAPTERS } from "./content";
import { getLearningSections, type LearningSection } from "./learning/sections";
import type { Chapter } from "./types";
import { LibraryView } from "./views/LibraryView";
import { ReaderView } from "./views/ReaderView";
import { LocaleProvider } from "./i18n/LocaleProvider";
import { UI_LOCALES } from "./i18n/types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const $$ = (sel: string) => [...container.querySelectorAll(sel)] as HTMLElement[];

function click(el: Element | null | undefined) {
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

function chapterById(id: string): Chapter {
  const chapter = CHAPTERS.find((ch) => ch.id === id);
  if (!chapter) throw new Error(`chapter not found: ${id}`);
  return chapter;
}

function firstSection(chapter: Chapter): LearningSection {
  const section = getLearningSections(chapter)?.sections[0];
  if (!section) throw new Error(`section not found: ${chapter.id}`);
  return section;
}

function sectionsOf(chapter: Chapter): LearningSection[] {
  return getLearningSections(chapter)?.sections ?? [];
}

function titleOf(el: Element): string {
  return el.querySelector(".library-card-title")!.textContent ?? "";
}

function tocTitleOf(el: Element): string {
  return el.querySelector(".reader-toc-title")!.textContent ?? "";
}

function openLibraryChapter(chapter: Chapter) {
  act(() =>
    root.render(
      <LocaleProvider supportedLocales={UI_LOCALES}>
        <LibraryView
          chapters={[chapter]}
          query=""
          onQueryChange={() => {}}
          onOpenCard={() => {}}
        />
      </LocaleProvider>
    )
  );
  click($$(".library-chapter-toggle")[0]);
}

function librarySectionItems(index: number): HTMLElement[] {
  const section = $$(".library-section")[index];
  if (!section) return [];
  return [...section.querySelectorAll<HTMLElement>(".library-card-item")];
}

function firstLibrarySectionItems(): HTMLElement[] {
  return librarySectionItems(0);
}

function openReader(chapter: Chapter, section: LearningSection) {
  act(() =>
    root.render(
      <LocaleProvider supportedLocales={UI_LOCALES}>
        <ReaderView
          key={section.id}
          chapter={chapter}
          chapterNumber={CHAPTERS.indexOf(chapter) + 1}
          section={section}
          onBack={() => {}}
          onPracticeChapter={() => {}}
        />
      </LocaleProvider>
    )
  );
}

function openToc() {
  click($$(".reader-toc-toggle")[0]);
}

function tocItems(): HTMLElement[] {
  return $$(".reader-toc-item");
}

function expectNumbered(
  items: HTMLElement[],
  titleSelector: string,
  indexSelector: string,
  expectedTitles: string[]
) {
  expect(
    items.map((item) => item.querySelector(titleSelector)!.textContent ?? "")
  ).toEqual(expectedTitles);
  expect(items.map((item) => item.querySelector(indexSelector)!.textContent)).toEqual(
    expectedTitles.map((_, index) => `${index + 1}.`)
  );
}

describe.skipIf(__FGE_EDITION__ !== "public")("公开章节按源序呈现", () => {
  test("C01 讲解库两个小节各自 5/7 张卡按源序编号，无旧单元标题", () => {
    const chapter = chapterById("pub-c01-boundaries");
    const sections = sectionsOf(chapter);
    expect(sections.map((section) => section.title)).toEqual([
      "冠词",
      "省音与缩合",
    ]);
    expect(sections.map((section) => section.cards.length)).toEqual([5, 7]);

    openLibraryChapter(chapter);

    expect($$(".library-section").length).toBe(2);
    expect($$(".library-section-title").map((el) => el.textContent)).toEqual(
      sections.map((section) => section.title)
    );
    sections.forEach((section, index) => {
      const items = librarySectionItems(index);
      expect(items.length).toBe(section.cards.length);
      expectNumbered(
        items,
        ".library-card-title",
        ".library-card-index",
        section.cards.map((card) => card.title)
      );
    });
    expect($$(".library-unit-title").length).toBe(0);
    expect(container.textContent).not.toContain("第6单元");
  });

  test("C01 阅读器两个小节目录各自同序，点每一项都落到对应正文", () => {
    const chapter = chapterById("pub-c01-boundaries");
    const sections = sectionsOf(chapter);
    expect(sections.map((section) => section.title)).toEqual([
      "冠词",
      "省音与缩合",
    ]);
    expect(sections.map((section) => section.cards.length)).toEqual([5, 7]);

    for (const section of sections) {
      openReader(chapter, section);
      openToc();

      expect($$(".reader-toc-item").length).toBe(section.cards.length);
      expectNumbered(
        tocItems(),
        ".reader-toc-title",
        ".reader-toc-index",
        section.cards.map((card) => card.title)
      );
      expect($$(".reader-toc-unit-title").length).toBe(0);

      section.cards.forEach((card, index) => {
        if ($$(".reader-toc-list").length === 0) openToc();
        click(tocItems()[index]);
        expect($$(".card-title")[0]!.textContent).toBe(card.title);
        expect($$(".reader-counter")[0]!.textContent).toBe(
          `${index + 1}/${section.cards.length}`
        );
      });
    }
  });

  test("C05 首四张概览在讲解库与阅读器目录最前", () => {
    const chapter = chapterById("pub-c05-present");
    const section = firstSection(chapter);
    const overviewTitles = chapter.cards.slice(0, 4).map((card) => card.title);
    expect(section.cards.slice(0, 4).map((card) => card.title)).toEqual(
      overviewTitles
    );

    openLibraryChapter(chapter);
    expect(firstLibrarySectionItems().slice(0, 4).map(titleOf)).toEqual(
      overviewTitles
    );
    expect($$(".library-unit-title").length).toBe(0);

    openReader(chapter, section);
    openToc();
    expect(tocItems().slice(0, 4).map(tocTitleOf)).toEqual(overviewTitles);
    expect($$(".reader-toc-unit-title").length).toBe(0);
  });

  test("C02 s1 的 card-u3-3 按源序仍在第四张", () => {
    const chapter = chapterById("pub-c02-noun-phrases");
    const section = firstSection(chapter);
    expect(section.cards[3]!.id).toBe("pub-c02-noun-phrases-card-u3-3");

    openLibraryChapter(chapter);
    const libraryItems = firstLibrarySectionItems();
    expectNumbered(
      libraryItems,
      ".library-card-title",
      ".library-card-index",
      section.cards.map((card) => card.title)
    );
    expect(titleOf(libraryItems[3]!)).toBe(section.cards[3]!.title);
    expect($$(".library-unit-title").length).toBe(0);

    openReader(chapter, section);
    openToc();
    expectNumbered(
      tocItems(),
      ".reader-toc-title",
      ".reader-toc-index",
      section.cards.map((card) => card.title)
    );
    expect(tocTitleOf(tocItems()[3]!)).toBe(section.cards[3]!.title);
    expect($$(".reader-toc-unit-title").length).toBe(0);
  });
});
