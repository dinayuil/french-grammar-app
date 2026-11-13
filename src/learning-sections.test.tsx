import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { vi, describe, expect, test, beforeEach, afterEach } from "vitest";

vi.mock("virtual:fge-content", async () => {
  const { sectionedChapters } = await import("./test/sectionFixtures");
  return { CHAPTERS: sectionedChapters };
});

import App from "./App";
import { STORAGE_KEY } from "./config";
import { sectionedMap } from "./test/sectionFixtures";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const $$ = (sel: string) => [...container.querySelectorAll(sel)];

const scrollIntoView = vi.fn();
const originalScrollIntoView = Element.prototype.scrollIntoView;

function click(el: Element | null | undefined) {
  if (!el) throw new Error("element not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

function seed(partial: Record<string, unknown>) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      xp: 0,
      dailyGoal: 30,
      days: {},
      lessons: {},
      mistakes: {},
      ...partial,
    })
  );
}

function renderApp() {
  act(() => root.render(<App sectionMap={sectionedMap} />));
}

const sectionCards = () =>
  $$(".section-card:not(.section-comprehensive)") as HTMLElement[];

const comprehensiveCard = () =>
  container.querySelector(".section-comprehensive") as HTMLElement | null;

function openFirstChapter() {
  click($$(".chapter-toggle")[0]!);
}

function answerCurrentQuestion() {
  click($$(".option-btn")[0]!);
  click($$(".btn-wide")[0]!); // 检查
  click($$(".btn-wide")[0]!); // 继续
}

function settlementButton(text: string): HTMLElement | undefined {
  return $$(".settlement-actions button").find((button) =>
    button.textContent?.includes(text)
  ) as HTMLElement | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
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
});

describe("首页小章呈现", () => {
  test("专题展开后显示小章标题、讲解数与各自完成度，展开只显示该小章练习", () => {
    seed({
      lessons: {
        "sec-demo-l1-1": { completed: true, stars: 2 },
        "sec-demo-x1": { completed: true, stars: 3 },
      },
    });
    renderApp();
    openFirstChapter();

    const sections = sectionCards();
    expect(sections.length).toBe(2);
    expect(sections[0]!.textContent).toContain("主题一 · 基础");
    expect(sections[0]!.textContent).toContain("2 张讲解");
    expect(sections[0]!.textContent).toContain("1/2 关");
    expect(sections[1]!.textContent).toContain("主题二 · 进阶");
    expect(sections[1]!.textContent).toContain("3 张讲解");
    expect(sections[1]!.textContent).toContain("0/1 关");
    expect(
      $$(".chapter-card")[0]!.querySelector(".chapter-head .btn-cards")
    ).toBeNull();

    // 多小章专题先展示紧凑的小章选择，选中小章后再显示练习。
    expect(sections[0]!.querySelector(".lesson-list")).toBeNull();
    expect(sections[1]!.querySelector(".lesson-list")).toBeNull();

    click(sections[0]!.querySelector(".section-toggle"));
    expect(sections[0]!.querySelectorAll(".lesson-item").length).toBe(2);
    expect(sections[0]!.textContent).toContain("主题一练习一");
    expect(sections[0]!.textContent).toContain("主题一练习二");
    expect(sections[1]!.querySelector(".lesson-list")).toBeNull();

    click(sections[1]!.querySelector(".section-toggle"));
    expect(sections[0]!.querySelector(".lesson-list")).toBeNull();
    expect(sections[1]!.querySelectorAll(".lesson-item").length).toBe(1);
    expect(sections[1]!.textContent).toContain("主题二练习一");
    expect(sections[1]!.textContent).not.toContain("主题一练习一");

    click(sections[0]!.querySelector(".section-toggle"));
    expect(sections[0]!.querySelectorAll(".lesson-item").length).toBe(2);
    expect(sections[1]!.querySelector(".lesson-list")).toBeNull();

    const comprehensive = comprehensiveCard()!;
    expect(comprehensive.textContent).toContain("专题综合挑战");
    expect(comprehensive.textContent).toContain("1/2 关");
    click(comprehensive.querySelector(".section-toggle"));
    expect(comprehensive.querySelectorAll(".lesson-item").length).toBe(2);
  });

  test("未配置小章的专题保持整章列表与章节级讲解入口", () => {
    renderApp();
    const legacy = $$(".chapter-card")[1] as HTMLElement;
    click(legacy.querySelector(".chapter-toggle"));
    expect(legacy.querySelectorAll(".section-card").length).toBe(0);
    expect(legacy.querySelectorAll(".lesson-item").length).toBe(3);
    expect(legacy.querySelector(".btn-cards")).not.toBeNull();

    click(legacy.querySelector(".btn-cards"));
    expect($$(".reader").length).toBe(1);
    expect($$(".reader-counter")[0]!.textContent).toBe("1/1");
    expect(container.querySelector(".reader-section-name")).toBeNull();
  });
});

describe("小章阅读范围与练习入口", () => {
  test("小章讲解只遍历本节卡片，上下张和目录分母限定在小章内", () => {
    renderApp();
    openFirstChapter();
    document.documentElement.scrollTop = 500;
    document.body.scrollTop = 500;
    click(sectionCards()[1]!.querySelector(".section-cards"));

    expect($$(".reader").length).toBe(1);
    expect(container.textContent).toContain("第1章 · 分区演示专题");
    expect(container.textContent).toContain("主题二 · 进阶");
    expect($$(".reader-counter")[0]!.textContent).toBe("1/3");
    expect(($$(".reader-prev")[0] as HTMLButtonElement).disabled).toBe(true);
    // 从首页的滚动位置进入阅读器时，页面回到顶部。
    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
    expect(($$(".reader-body")[0] as HTMLElement).scrollTop).toBe(0);

    click($$(".reader-next")[0]!);
    click($$(".reader-next")[0]!);
    expect($$(".reader-counter")[0]!.textContent).toBe("3/3");
    expect(($$(".reader-next")[0] as HTMLButtonElement).disabled).toBe(true);

    click($$(".reader-toc-toggle")[0]!);
    expect($$(".reader-toc-item").length).toBe(3);
    expect(container.textContent).toContain("主题二讲解三");
    expect(container.textContent).not.toContain("主题一讲解一");
  });

  test("「练习本章」回到该小章并聚焦小章切换按钮", () => {
    renderApp();
    openFirstChapter();
    click(sectionCards()[1]!.querySelector(".section-cards"));
    click($$(".reader-practice")[0]!);

    const sections = sectionCards();
    expect(sections[0]!.querySelector(".lesson-list")).toBeNull();
    expect(sections[1]!.querySelector(".lesson-list")).not.toBeNull();
    expect(document.activeElement).toBe(
      sections[1]!.querySelector(".section-toggle")
    );
  });

  test("练习关闭后展开小章并聚焦原关卡", () => {
    renderApp();
    openFirstChapter();
    const firstSection = sectionCards()[0]!;
    click(firstSection.querySelector(".section-toggle"));
    click(firstSection.querySelector(".lesson-item"));

    expect($$(".lesson").length).toBe(1);
    click($$(".btn-ghost")[0]!);

    const sections = sectionCards();
    expect(sections[0]!.querySelector(".lesson-list")).not.toBeNull();
    const item = sections[0]!.querySelector(".lesson-item");
    expect(document.activeElement).toBe(item);
    expect(scrollIntoView.mock.instances).toContain(item);
  });
});

describe("讲解库按小章选择与搜索归属", () => {
  test("讲解库展开专题后按小章分组，开始阅读进入该小章范围", () => {
    renderApp();
    click($$(".nav-item").find((el) => el.textContent === "讲解")!);
    click($$(".library-chapter-toggle")[0]!);

    expect($$(".library-section").length).toBe(2);
    expect($$(".library-section-title").map((el) => el.textContent)).toEqual([
      "主题一 · 基础",
      "主题二 · 进阶",
    ]);
    expect($$(".library-card-item").length).toBe(5);
    expect($$(".library-unit-title").length).toBe(2);

    click($$(".library-section-start")[1]!);
    expect($$(".reader").length).toBe(1);
    expect($$(".reader-counter")[0]!.textContent).toBe("1/3");
    expect(container.textContent).toContain("主题二 · 进阶");
  });

  test("搜索命中后部卡片直接进入所属小章并定位该卡", () => {
    renderApp();
    click($$(".nav-item").find((el) => el.textContent === "讲解")!);
    typeQuery("主题二讲解三");

    expect(container.textContent).toContain("找到 1 条结果");
    expect(container.textContent).toContain("主题二 · 进阶");
    document.documentElement.scrollTop = 640;
    document.body.scrollTop = 640;
    click($$(".library-result-item")[0]!);

    expect($$(".reader").length).toBe(1);
    expect($$(".reader-counter")[0]!.textContent).toBe("3/3");
    expect(container.textContent).toContain("主题二 · 进阶");
    expect(container.textContent).toContain("主题二讲解三");
    // 从搜索结果的滚动位置进入阅读器也必须回到顶部。
    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
    expect(($$(".reader-body")[0] as HTMLElement).scrollTop).toBe(0);
  });
});

describe("下一关与小章终点", () => {
  test("下一关只在小章内推进，最后一关不再出现", () => {
    renderApp();
    openFirstChapter();
    const firstSection = sectionCards()[0]!;
    click(firstSection.querySelector(".section-toggle"));
    click(firstSection.querySelectorAll(".lesson-item")[0]!);

    expect(container.textContent).toContain("Première question du thème un.");
    answerCurrentQuestion();
    expect(container.textContent).toContain("练习完成");
    const next = settlementButton("下一关");
    expect(next).toBeDefined();
    click(next);

    expect(container.textContent).toContain("Deuxième question du thème un.");
    expect(container.textContent).not.toContain("Question du thème deux.");
    answerCurrentQuestion();
    expect(container.textContent).toContain("练习完成");
    expect(settlementButton("下一关")).toBeUndefined();

    click(settlementButton("返回"));
    const sections = sectionCards();
    expect(sections[0]!.querySelector(".lesson-list")).not.toBeNull();
    expect(document.activeElement).toBe(
      sections[0]!.querySelectorAll(".lesson-item")[1]
    );
  });

  test("专题综合挑战按综合区顺序推进，到末尾停止", () => {
    renderApp();
    openFirstChapter();
    const comprehensive = comprehensiveCard()!;
    click(comprehensive.querySelector(".section-toggle"));
    click(comprehensive.querySelectorAll(".lesson-item")[0]!);

    answerCurrentQuestion();
    expect(container.textContent).toContain("挑战完成");
    click(settlementButton("下一关"));
    expect(container.textContent).toContain("Deuxième défi global.");
    answerCurrentQuestion();
    expect(settlementButton("下一关")).toBeUndefined();
  });
});

describe("小章进度汇总", () => {
  test("旧星级按原始关卡 ID 计入所属小章和专题综合区", () => {
    seed({
      lessons: {
        "sec-demo-l1-1": { completed: true, stars: 1 },
        "sec-demo-l1-2": { completed: true, stars: 3 },
        "sec-demo-l2-1": { completed: true, stars: 2 },
        "sec-demo-x2": { completed: true, stars: 3 },
      },
    });
    renderApp();
    openFirstChapter();

    const sections = sectionCards();
    expect(sections[0]!.textContent).toContain("2/2 关");
    expect(sections[0]!.textContent).toContain("已完成");
    expect(sections[1]!.textContent).toContain("1/1 关");
    expect(comprehensiveCard()!.textContent).toContain("1/2 关");
  });

  test("映射没有覆盖的章节仍显示整章完成度", () => {
    seed({ lessons: { "legacy-demo-l1": { completed: true, stars: 3 } } });
    renderApp();
    const legacy = $$(".chapter-card")[1] as HTMLElement;
    expect(legacy.textContent).toContain("1/3");
    expect(legacy.textContent).toContain("整章回退专题");
  });
});

describe("法国主题折叠与真实进度", () => {
  test("首页问候固定为 Bonjour，今天练一点 français，不带 le", () => {
    renderApp();
    const greeting = container.querySelector(".home-greeting");
    expect(greeting).not.toBeNull();
    expect(greeting!.textContent).toContain("Bonjour，今天练一点 français");
    expect(greeting!.textContent).not.toContain("le français");
  });

  test("章节按钮有 aria-expanded、章节序号和无障碍名称，展开态写入 is-open", () => {
    renderApp();
    const chapter = $$(".chapter-card")[0] as HTMLElement;
    const toggle = chapter.querySelector(".chapter-toggle") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toContain("第1章");
    expect(chapter.querySelector(".chapter-index")?.textContent).toContain("01");
    expect(
      chapter.querySelector(".plus-minus-icon")?.getAttribute("aria-hidden")
    ).toBe("true");
    click(toggle);
    expect(chapter.classList.contains("is-open")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  test("小章折叠由独立 plus/minus 按钮控制，点击不会打开讲解", () => {
    renderApp();
    openFirstChapter();
    const section = sectionCards()[0] as HTMLElement;
    const fold = section.querySelector(".section-fold") as HTMLButtonElement;
    expect(fold).not.toBeNull();
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    const sectionTitle = section.querySelector(".section-title")?.textContent ?? "";
    expect(fold.getAttribute("aria-label")).toContain(sectionTitle);
    expect(
      fold.querySelector(".plus-minus-icon")?.getAttribute("aria-hidden")
    ).toBe("true");
    click(fold);
    expect(section.classList.contains("is-open")).toBe(true);
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect($$(".reader").length).toBe(0);
    click(fold);
    expect(section.classList.contains("is-open")).toBe(false);
    expect(fold.getAttribute("aria-expanded")).toBe("false");
  });

  test("讲解入口是标题行的兄弟按钮，点击只进入阅读器", () => {
    renderApp();
    openFirstChapter();
    const section = sectionCards()[0] as HTMLElement;
    expect(section.querySelector(".section-toggle .btn-cards")).toBeNull();
    const cards = section.querySelector(".section-head .btn-cards") as HTMLButtonElement;
    expect(cards).not.toBeNull();
    click(cards);
    expect($$(".reader").length).toBe(1);
  });

  test("章节进度来自真实完成数，不是预览硬编码", () => {
    seed({ lessons: { "sec-demo-l1-1": { completed: true, stars: 1 } } });
    renderApp();
    const chapter = $$(".chapter-card")[0] as HTMLElement;
    const fill = chapter.querySelector(".chapter-progress > span") as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).not.toBe("0%");
    expect(chapter.textContent).toContain("1/");
  });
});
