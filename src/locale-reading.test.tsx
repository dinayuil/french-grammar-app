import { createRoot, type Root } from "react-dom/client";
import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Chapter, Progress } from "./types";
import { DEFAULT_PROGRESS, today } from "./storage";
import type { LearningSection, SectionMap } from "./learning/sections";
import { LocaleProvider, useLocale } from "./i18n/LocaleProvider";
import { UI_LOCALES } from "./i18n/types";
import { HomeView } from "./views/HomeView";
import { LibraryView } from "./views/LibraryView";
import { ReaderView } from "./views/ReaderView";
import { readingZhCN } from "./i18n/reading.zh-CN";
import { readingFr } from "./i18n/reading.fr";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const LONG_FRENCH_BODY =
  "<p>Cette fiche présente un long texte français destiné à vérifier que le lecteur affiche le contenu localisé en entier, sans troncature ni retour au texte chinois d'origine.</p>";

const demoChapter: Chapter = {
  id: "locale-demo",
  title: "中文章名",
  titleFr: "Chapitre localisé",
  locales: {
    fr: {
      sectionTitles: {
        basics: "Les bases",
        advanced: "Approfondissement",
      },
    },
  },
  cards: [
    {
      id: "locale-demo-card-1",
      title: "中文卡片一",
      body: "中文正文一",
      locales: {
        fr: {
          title: "Première fiche",
          body: "<p>Premier contenu français.</p>",
        },
      },
    },
    {
      id: "locale-demo-card-2",
      title: "中文卡片二",
      body: "中文正文二",
      locales: {
        fr: {
          title: "Deuxième fiche",
          body: LONG_FRENCH_BODY,
        },
      },
    },
  ],
  lessons: [
    {
      id: "locale-demo-l1",
      title: "中文练习一",
      kind: "lesson",
      source: "测试",
      locales: { fr: { title: "Leçon une" } },
      questions: [
        {
          id: "locale-demo-l1-q1",
          prompt: "Choisissez la bonne réponse.",
          explain: "Explication.",
          type: "choice",
          options: ["a", "b"],
          answer: 0,
        },
      ],
    },
  ],
  challenges: [
    {
      id: "locale-demo-x1",
      title: "中文挑战",
      kind: "challenge",
      source: "测试",
      locales: { fr: { title: "Défi final" } },
      questions: [
        {
          id: "locale-demo-x1-q1",
          prompt: "Défi.",
          explain: "Explication.",
          type: "choice",
          options: ["a", "b"],
          answer: 0,
        },
      ],
    },
  ],
};

const demoSectionMap: SectionMap = {
  "locale-demo": {
    sections: [
      {
        key: "basics",
        title: "基础小节",
        cardIds: ["locale-demo-card-1"],
        lessonIds: ["locale-demo-l1"],
      },
      {
        key: "advanced",
        title: "进阶小节",
        cardIds: ["locale-demo-card-2"],
      },
    ],
    comprehensive: { challengeIds: ["locale-demo-x1"] },
  },
};

const readerSection: LearningSection = {
  id: "locale-demo::basics",
  title: "基础小节",
  kind: "section",
  cards: demoChapter.cards,
  lessons: demoChapter.lessons,
  challenges: [],
};

function bigHomeChapter(lessonCount: number): Chapter {
  const lessons = Array.from({ length: lessonCount }, (_, index) => ({
    id: `big-home-l${index + 1}`,
    title: `Leçon ${index + 1}`,
    kind: "lesson" as const,
    source: "测试",
    questions: [
      {
        id: `big-home-l${index + 1}-q1`,
        prompt: "Question.",
        explain: "Explication.",
        type: "choice" as const,
        options: ["a", "b"],
        answer: 0,
      },
    ],
  }));
  return {
    id: "big-home",
    title: "大章节",
    titleFr: "Grand chapitre",
    cards: [],
    lessons,
    challenges: [],
  };
}

function bigLibraryChapter(cardCount: number): Chapter {
  return {
    id: "big-library",
    title: "大型讲解库",
    titleFr: "Grande bibliothèque",
    cards: Array.from({ length: cardCount }, (_, index) => ({
      id: `big-library-card-${index + 1}`,
      title: `Fiche ${index + 1}`,
      body: `Contenu ${index + 1}`,
    })),
    lessons: [],
    challenges: [],
  };
}

function LocaleSwitch() {
  const { locale, setLocale } = useLocale();
  return (
    <div>
      <button type="button" data-testid="to-zh" onClick={() => setLocale("zh-CN")}>
        zh-CN
      </button>
      <button type="button" data-testid="to-fr" onClick={() => setLocale("fr")}>
        fr
      </button>
      <span data-testid="locale">{locale}</span>
    </div>
  );
}

function HomeHarness({
  progress = DEFAULT_PROGRESS,
  chapters = [demoChapter],
}: {
  progress?: Progress;
  chapters?: Chapter[];
}) {
  return (
    <LocaleProvider supportedLocales={UI_LOCALES}>
      <LocaleSwitch />
      <HomeView
        chapters={chapters}
        progress={progress}
        sectionMap={demoSectionMap}
        onOpenLesson={() => {}}
        onOpenCards={() => {}}
        onOpenReview={() => {}}
      />
    </LocaleProvider>
  );
}

function LibraryHarness({
  initialQuery = "",
  chapters = [demoChapter],
}: {
  initialQuery?: string;
  chapters?: Chapter[];
}) {
  const [query, setQuery] = useState(initialQuery);
  return (
    <LocaleProvider supportedLocales={UI_LOCALES}>
      <LocaleSwitch />
      <LibraryView
        chapters={chapters}
        query={query}
        onQueryChange={setQuery}
        onOpenCard={() => {}}
        sectionMap={demoSectionMap}
      />
    </LocaleProvider>
  );
}

function ReaderHarness({ onBack }: { onBack: () => void }) {
  return (
    <LocaleProvider supportedLocales={UI_LOCALES}>
      <LocaleSwitch />
      <ReaderView
        chapter={demoChapter}
        chapterNumber={1}
        section={readerSection}
        onBack={onBack}
        onPracticeChapter={() => {}}
      />
    </LocaleProvider>
  );
}

let container: HTMLDivElement;
let root: Root;

const $$ = (selector: string) =>
  [...container.querySelectorAll(selector)] as HTMLElement[];

function click(element: Element | null | undefined) {
  if (!element) throw new Error("element not found");
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function typeQuery(value: string) {
  const input = $$(".library-search")[0] as HTMLInputElement | undefined;
  if (!input) throw new Error("search input not found");
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )!.set!;
  act(() => {
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function localeButton(locale: "fr" | "zh-CN"): HTMLElement {
  return $$(`[data-testid="to-${locale === "fr" ? "fr" : "zh"}"]`)[0]!;
}

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

describe("阅读域文案目录", () => {
  test("中法键集合、占位符与非空文案一致，且使用约定前缀", () => {
    const zhKeys = Object.keys(readingZhCN).sort();
    const frCatalog = readingFr as Record<string, string>;
    expect(Object.keys(frCatalog).sort()).toEqual(zhKeys);
    for (const key of zhKeys) {
      expect(key).toMatch(/^(home|library|reader|section)\./);
      expect(readingZhCN[key as keyof typeof readingZhCN].trim()).not.toBe("");
      expect(frCatalog[key]!.trim()).not.toBe("");
      const placeholders = (value: string) =>
        [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)]
          .map((match) => match[1])
          .sort();
      expect(placeholders(readingZhCN[key as keyof typeof readingZhCN])).toEqual(
        placeholders(frCatalog[key]!)
      );
    }
  });
});

describe("数字格式化与 Intl 一致", () => {
  test("首页 XP、达成差额和章节计数使用当前语言数字分组", () => {
    const progress: Progress = {
      ...DEFAULT_PROGRESS,
      xp: 2500,
      dailyGoal: 30,
      days: {
        [today()]: { xp: 1200, earnedQids: [], bonusIds: [] },
      },
    };
    act(() => root.render(<HomeHarness progress={progress} />));
    click(localeButton("fr"));

    expect($$(".hero-goal-value")[0]!.textContent).toBe("1\u202f200 / 30 XP");
    expect($$(".hero-goal-note")[0]!.textContent).toBe(
      "Atteint · 1\u202f170 XP en plus"
    );

    act(() => root.render(<HomeHarness chapters={[bigHomeChapter(1000)]} />));
    click(localeButton("fr"));

    expect($$(".chapter-count")[0]!.textContent).toBe("0/1\u202f000");
    expect($$(".chapter-toggle")[0]!.getAttribute("aria-label")).toBe(
      "Chapitre 1 Grand chapitre, 0/1\u202f000 terminés"
    );
  });

  test("讲解库章节计数与 aria 使用当前语言数字分组", () => {
    act(() =>
      root.render(<LibraryHarness chapters={[bigLibraryChapter(1000)]} />)
    );
    click(localeButton("fr"));

    expect($$(".library-chapter-count")[0]!.textContent).toBe(
      "1\u202f000 fiches"
    );
    expect(
      $$(".library-chapter-toggle")[0]!.getAttribute("aria-label")
    ).toBe("Chapitre 1 Grande bibliothèque, 1\u202f000 fiches");
  });
});

describe("首页阅读范围的本地化", () => {
  test("切换语言保留展开状态，显示法语章名且不重复章名副标题", () => {
    act(() => root.render(<HomeHarness />));

    click($$(".chapter-toggle")[0]);
    expect($$(".chapter-card")[0]!.classList.contains("is-open")).toBe(true);
    expect($$(".chapter-title")[0]!.textContent).toBe("中文章名");
    expect($$(".chapter-title-fr")[0]!.textContent).toBe("Chapitre localisé");

    click(localeButton("fr"));
    expect($$('[data-testid="locale"]')[0]!.textContent).toBe("fr");
    expect($$(".chapter-card")[0]!.classList.contains("is-open")).toBe(true);
    expect($$(".chapter-card")[0]!.querySelector(".lesson-list")).not.toBeNull();
    expect($$(".chapter-title")[0]!.textContent).toBe("Chapitre localisé");
    expect($$(".chapter-title-fr").length).toBe(0);
    expect($$(".section-title").map((el) => el.textContent)).toEqual([
      "Les bases",
      "Approfondissement",
      "Défis de synthèse",
    ]);
    expect(container.textContent).toContain("Leçon une");
    expect(container.textContent).toContain("Défi final");

    click(localeButton("zh-CN"));
    expect($$(".chapter-title")[0]!.textContent).toBe("中文章名");
    expect($$(".chapter-title-fr")[0]!.textContent).toBe("Chapitre localisé");
    expect($$(".chapter-card")[0]!.classList.contains("is-open")).toBe(true);
    expect($$(".section-title").map((el) => el.textContent)).toEqual([
      "基础小节",
      "进阶小节",
      "专题综合挑战",
    ]);
  });
});

describe("讲解库本地化与搜索", () => {
  test("换语言清空查询与结果，按当前语言重建索引，展开状态保留", () => {
    act(() => root.render(<LibraryHarness />));

    click($$(".library-chapter-toggle")[0]);
    expect($$(".library-card-item").length).toBe(2);
    expect($$(".library-section-title").map((el) => el.textContent)).toEqual([
      "基础小节",
      "进阶小节",
    ]);

    typeQuery("中文卡片一");
    expect(container.textContent).toContain("找到 1 条结果");
    expect(container.textContent).toContain("中文卡片一");

    click(localeButton("fr"));
    expect(($$(".library-search")[0] as HTMLInputElement).value).toBe("");
    expect($$(".library-result-item").length).toBe(0);
    expect($$(".library-chapter")[0]!.classList.contains("is-open")).toBe(true);
    expect($$(".library-section-title").map((el) => el.textContent)).toEqual([
      "Les bases",
      "Approfondissement",
    ]);
    expect($$(".library-card-title")[0]!.textContent).toBe("Première fiche");

    typeQuery("premiere fiche");
    expect(container.textContent).toContain("1 résultat(s)");
    expect(container.textContent).toContain("Première fiche");
    expect(container.querySelector("mark")?.textContent).toBe("Première");

    typeQuery("中文卡片一");
    expect(container.textContent).toContain("Aucune fiche pour « 中文卡片一 »");

    typeQuery("troncature");
    expect(container.textContent).toContain("1 résultat(s)");
    expect(container.textContent).toContain("Deuxième fiche");
    click(localeButton("zh-CN"));
    expect(($$(".library-search")[0] as HTMLInputElement).value).toBe("");
    expect($$(".library-card-title")[0]!.textContent).toBe("中文卡片一");
  });

  test("初次挂载已有查询不误清", () => {
    act(() => root.render(<LibraryHarness initialQuery="中文正文一" />));

    expect(($$(".library-search")[0] as HTMLInputElement).value).toBe(
      "中文正文一"
    );
    expect(container.textContent).toContain("找到 1 条结果");
    expect(container.textContent).toContain("中文卡片一");
  });
});

describe("阅读器本地化", () => {
  test("切换语言保留当前卡片，只切换标题正文和小节名，返回目录行为不变", () => {
    const onBack = vi.fn();
    act(() => root.render(<ReaderHarness onBack={onBack} />));

    expect($$(".reader-counter")[0]!.textContent).toBe("1/2");
    click($$(".reader-next")[0]);
    expect($$(".reader-counter")[0]!.textContent).toBe("2/2");
    expect($$(".card-title")[0]!.textContent).toBe("中文卡片二");

    click(localeButton("fr"));
    expect($$(".reader-counter")[0]!.textContent).toBe("2/2");
    expect($$(".card-title")[0]!.textContent).toBe("Deuxième fiche");
    expect($$(".card-body")[0]!.textContent).toContain(
      "long texte français destiné"
    );
    expect($$(".reader-section-name")[0]!.textContent).toBe("Les bases");
    expect(container.textContent).toContain("Chapitre 1 · Chapitre localisé");

    click($$(".reader-back")[0]);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
