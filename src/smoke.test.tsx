import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { vi } from "vitest";

vi.mock("virtual:fge-content", async () => {
  const { syntheticChapter } = await import("./test/fixtures");
  return { CHAPTERS: [syntheticChapter] };
});

import App from "./App";
import { CHAPTERS } from "./content";
import { STORAGE_KEY } from "./config";
import type { Lesson, Question } from "./types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const isPublic = __FGE_EDITION__ === "public";
const chapter = CHAPTERS[0];
const allLessons = [...chapter.lessons, ...chapter.challenges];
const firstLesson = chapter.lessons[0];

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

const $$ = (sel: string) => [...container.querySelectorAll(sel)];

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** 按正确答案回答当前题目(letters/tiles/choice 三种题型) */
function answerCorrectly(q: Question) {
  if (q.type === "letters") {
    for (const ch of [...q.answer]) {
      const btn = $$(".tile").find(
        (t) =>
          t.textContent === ch &&
          !t.className.includes("used") &&
          !t.className.includes("accent") &&
          !(t as HTMLButtonElement).disabled
      );
      expect(btn).toBeDefined();
      click(btn!);
    }
  } else if (q.type === "tiles") {
    for (const w of q.answer) {
      const btn = $$(".tile").find(
        (t) => t.textContent === w && !t.className.includes("used") && !(t as HTMLButtonElement).disabled
      );
      expect(btn).toBeDefined();
      click(btn!);
    }
  } else {
    click($$(".option-btn")[q.answer]!);
  }
}

function openFirstLesson() {
  act(() => root.render(<App />));
  click($$(".chapter-toggle")[0]!);
  click($$(".lesson-item")[0]!);
}

function playLesson(lesson: Lesson, wrongFirst = false) {
  for (let i = 0; i < lesson.questions.length; i++) {
    const q = lesson.questions[i];
    if (wrongFirst && i === 0) {
      click($$(".tile").filter((t) => !t.className.includes("accent"))[0]!);
    } else {
      answerCorrectly(q);
    }
    click($$(".btn-wide")[0]!); // 检查
    const cont = $$(".btn-wide")[0];
    if (cont) click(cont); // 继续
  }
}

function seed(partial: Record<string, unknown>) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ xp: 0, dailyGoal: 30, days: {}, lessons: {}, mistakes: {}, ...partial })
  );
}

function savedProgress() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
}

test("主页:全部章节、关卡全部直接可玩(无锁定)", () => {
  act(() => root.render(<App />));
  expect($$(".chapter-card").length).toBe(CHAPTERS.length);
  click($$(".chapter-toggle")[0]!);
  const items = $$(".lesson-item");
  expect(items.length).toBe(allLessons.length);
  expect(items.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
  expect(items.every((b) => !b.className.includes("st-locked"))).toBe(true);
});

test("讲解独立入口:章节卡上的「讲解」按钮打开阅读器", () => {
  act(() => root.render(<App />));
  click($$(".btn-cards")[0]!);
  expect($$(".reader").length).toBe(1);
  expect(container.textContent).toContain(chapter.cards[0].title);
  expect(container.textContent).toContain(chapter.cards[0].body);
  for (let i = 0; i < chapter.cards.length - 1; i++) {
    click($$(".reader-next")[0]!);
  }
  click($$(".reader-back")[0]!);
  expect($$(".chapter-card").length).toBe(CHAPTERS.length);
});

test("关卡直接从题目开始(不内嵌讲解),letters 正确判分 +2 XP", () => {
  openFirstLesson();
  expect(container.textContent).toContain(firstLesson.questions[0].prompt);
  expect(container.textContent).not.toContain(chapter.cards[0].title);
  answerCorrectly(firstLesson.questions[0]);
  click($$(".btn-wide")[0]!); // 检查
  expect(container.textContent).toContain("正确");
  expect(container.textContent).toContain("+2 XP");
  expect(savedProgress().xp).toBe(2);
});

test("答错判红并记入错题本", () => {
  openFirstLesson();
  const wrong = $$(".tile").filter((t) => !t.className.includes("accent"));
  click(wrong[0]!);
  click($$(".btn-wide")[0]!);
  expect(container.textContent).toContain("答错了");
  const saved = savedProgress();
  expect(Object.keys(saved.mistakes)).toHaveLength(1);
  expect(Object.keys(saved.mistakes)[0]).toBe(firstLesson.questions[0].id);
  expect((Object.values(saved.mistakes) as { count: number }[])[0].count).toBe(1);
});

test("复习关:错题组成的一关,答对移出错题本", () => {
  const mistakeId = firstLesson.questions[0].id;
  seed({ mistakes: { [mistakeId]: { lastWrong: "2026-10-27", count: 1 } } });
  act(() => root.render(<App />));
  const reviewBtn = $$(".btn-review")[0]!;
  expect((reviewBtn as HTMLButtonElement).disabled).toBe(false);
  expect(reviewBtn.textContent).toContain("1");

  click(reviewBtn);
  expect(container.textContent).toContain(firstLesson.questions[0].prompt);
  answerCorrectly(firstLesson.questions[0]);
  click($$(".btn-wide")[0]!); // 检查
  click($$(".btn-wide")[0]!); // 继续 → 结算
  expect(container.textContent).toContain("练习完成");
  const saved = savedProgress();
  expect(Object.keys(saved.mistakes)).toHaveLength(0);
  expect(saved.xp).toBe(12); // 2(答题)+ 5(过关)+ 5(全对奖:本会话零失误)

  click($$(".btn-secondary").filter((b) => b.textContent?.includes("返回"))[0]!);
  expect(($$(".btn-review")[0] as HTMLButtonElement).disabled).toBe(true);
});

test("全对路径:结算 3 星 + 过关奖 + 全对奖,关卡列表显示星级", () => {
  openFirstLesson();
  playLesson(firstLesson);
  const expectedXp = firstLesson.questions.length * 2 + 10;
  expect(container.textContent).toContain("全对!零失误!");
  expect(container.textContent).toContain("⭐⭐⭐");
  expect(container.textContent).toContain(`+${expectedXp} XP`);
  const saved = savedProgress();
  expect(saved.xp).toBe(expectedXp);
  expect(saved.lessons[firstLesson.id]).toEqual({ completed: true, stars: 3 });

  click($$(".bottom-nav button").filter((b) => b.textContent === "练习")[0]!);
  click($$(".chapter-toggle")[0]!);
  expect($$(".lesson-item")[0]!.textContent).toContain("★★★");
});

test("错题路径:重做补救全对 → 补发全对奖、3 星、错题清空", () => {
  openFirstLesson();
  playLesson(firstLesson, true);
  const firstTryXp = (firstLesson.questions.length - 1) * 2 + 5;
  expect(container.textContent).toContain("答错 1 题");
  expect(savedProgress().xp).toBe(firstTryXp);
  expect(savedProgress().lessons[firstLesson.id].stars).toBe(1);

  click($$(".btn-secondary").filter((b) => b.textContent?.includes("重做"))[0]!);
  answerCorrectly(firstLesson.questions[0]);
  click($$(".btn-wide")[0]!); // 检查
  click($$(".btn-wide")[0]!); // 继续 → 回结算
  expect(container.textContent).toContain("⭐⭐⭐");
  const saved = savedProgress();
  expect(saved.xp).toBe(firstTryXp + 1 + 5);
  expect(saved.lessons[firstLesson.id]).toEqual({ completed: true, stars: 3 });
  expect(Object.keys(saved.mistakes)).toHaveLength(0);
});

test("设置页:改每日目标并持久化;统计页渲染 7 根柱子", () => {
  act(() => root.render(<App />));
  click($$(".bottom-nav button").filter((b) => b.textContent === "设置")[0]!);
  click($$(".option-btn")[1]!); // 60 XP 档
  expect(savedProgress().dailyGoal).toBe(60);
  click($$(".bottom-nav button").filter((b) => b.textContent === "统计")[0]!);
  expect($$(".bar-col").length).toBe(7);
});

test("设置页:清空进度走二次确认,确认后回默认", () => {
  seed({ xp: 500 });
  act(() => root.render(<App />));
  click($$(".bottom-nav button").filter((b) => b.textContent === "设置")[0]!);
  click($$(".btn-danger-outline")[0]!);
  expect(container.textContent).toContain("确定清空全部进度");
  click($$(".btn-danger")[0]!);
  const saved = savedProgress();
  expect(saved.xp).toBe(0);
  expect(saved.dailyGoal).toBe(30);
});

test.skipIf(!isPublic)("public:清空进度不读取也不改写内部键", () => {
  const internalV2Key = "fge.progress.v2";
  const internalV1Key = "fge.progress.v1";
  const internalV2 = JSON.stringify({
    xp: 900,
    dailyGoal: 120,
    days: {},
    lessons: { [firstLesson.id]: { completed: true, stars: 3 } },
    mistakes: { [firstLesson.questions[0].id]: { lastWrong: "2026-10-27", count: 9 } },
  });
  const internalV1 = JSON.stringify({ xp: 800, dailyGoal: 60, days: {}, lessons: {}, mistakes: [] });
  localStorage.setItem(internalV2Key, internalV2);
  localStorage.setItem(internalV1Key, internalV1);

  const getSpy = vi.spyOn(Storage.prototype, "getItem");
  act(() => root.render(<App />));
  const readKeys = getSpy.mock.calls.map((c) => String(c[0]));
  expect(readKeys).not.toContain(internalV2Key);
  expect(readKeys).not.toContain(internalV1Key);

  click($$(".bottom-nav button").filter((b) => b.textContent === "设置")[0]!);
  const removeSpy = vi.spyOn(Storage.prototype, "removeItem");
  click($$(".btn-danger-outline")[0]!);
  click($$(".btn-danger")[0]!);
  expect(removeSpy.mock.calls.map((c) => String(c[0]))).toEqual([STORAGE_KEY]);
  getSpy.mockRestore();
  removeSpy.mockRestore();

  expect(localStorage.getItem(internalV2Key)).toBe(internalV2);
  expect(localStorage.getItem(internalV1Key)).toBe(internalV1);
});

test("letters 题词库含干扰字母:答案 4 字母 → 4+3=7 块", () => {
  const firstQuestion = firstLesson.questions[0];
  const answer = firstQuestion.type === "letters" ? firstQuestion.answer : "";
  openFirstLesson();
  expect($$(".letter-tiles .tile").length).toBe([...answer].length + 3);
});

test("下一关导航:完成第一关后点「下一关」直接进入第二关第一题", () => {
  openFirstLesson();
  playLesson(firstLesson);
  click($$(".btn-primary").filter((b) => b.textContent?.includes("下一关"))[0]!);
  expect(container.textContent).toContain(chapter.lessons[1].questions[0].prompt);
});

test("设置页:音效开关持久化,清空进度后恢复默认开启", () => {
  act(() => root.render(<App />));
  click($$(".bottom-nav button").filter((b) => b.textContent === "设置")[0]!);

  click($$(".option-btn").find((b) => b.textContent?.includes("🔇"))!);
  expect(savedProgress().sound).toBe(false);
  click($$(".option-btn").find((b) => b.textContent?.includes("🔊"))!);
  expect(savedProgress().sound).toBe(true);

  click($$(".btn-danger-outline")[0]!);
  click($$(".btn-danger")[0]!);
  expect(savedProgress().sound).toBe(true);
});

test("设置页:翻译开关与显示时机持久化", () => {
  act(() => root.render(<App />));
  click($$(".bottom-nav button").filter((b) => b.textContent === "设置")[0]!);

  click($$(".option-btn").find((b) => b.textContent === "关闭翻译")!);
  expect(savedProgress().translationEnabled).toBe(false);
  click($$(".option-btn").find((b) => b.textContent === "开启翻译")!);
  click($$(".option-btn").find((b) => b.textContent === "答题前显示")!);
  const saved = savedProgress();
  expect(saved.translationEnabled).toBe(true);
  expect(saved.translationTiming).toBe("before");
});

test("挑战关可玩:普通关 + 挑战关全部列出,首题判分正确", () => {
  act(() => root.render(<App />));
  click($$(".chapter-toggle")[0]!);
  const items = $$(".lesson-item");
  expect(items.length).toBe(allLessons.length);
  expect(items.filter((b) => b.className.includes("kind-challenge")).length).toBe(chapter.challenges.length);

  click(items[items.length - 1]!);
  const challengeQ = chapter.challenges[0].questions[0];
  expect(container.textContent).toContain(challengeQ.prompt);
  answerCorrectly(challengeQ);
  click($$(".btn-wide")[0]!);
  expect(container.textContent).toContain("正确");
});

test("判分后补全题干并显示翻译", () => {
  openFirstLesson();
  expect(container.textContent).not.toContain(firstLesson.questions[0].translation!);
  answerCorrectly(firstLesson.questions[0]);
  click($$(".btn-wide")[0]!);
  expect(container.textContent).toContain("Le ciel est bleu aujourd'hui.");
  expect(container.textContent).toContain(firstLesson.questions[0].translation!);
});
