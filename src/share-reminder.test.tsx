import { createRoot, type Root } from "react-dom/client";
import { act, useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("virtual:fge-content", async () => {
  const { syntheticChapter } = await import("./test/fixtures");
  return { CHAPTERS: [syntheticChapter] };
});

vi.mock("./share/shareStats", () => ({
  shareStatsCard: vi.fn(),
}));

import App from "./App";
import { LessonView } from "./views/LessonView";
import { CHAPTERS } from "./content";
import {
  STORAGE_KEY,
  XP_LESSON_BONUS,
  XP_PERFECT_BONUS,
  XP_PER_CORRECT,
} from "./config";
import { DEFAULT_PROGRESS, shiftDate, today } from "./storage";
import { shareStatsCard, type ShareResult } from "./share/shareStats";
import type { Lesson, Progress, Question } from "./types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const chapter = CHAPTERS[0];
const firstLesson = chapter.lessons[0];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const $$ = (sel: string) => [...container.querySelectorAll(sel)];

function click(el: Element | null | undefined) {
  if (!el) throw new Error("element not found");
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
      click(btn);
    }
  } else if (q.type === "tiles") {
    for (const w of q.answer) {
      const btn = $$(".tile").find(
        (t) =>
          t.textContent === w &&
          !t.className.includes("used") &&
          !(t as HTMLButtonElement).disabled
      );
      expect(btn).toBeDefined();
      click(btn);
    }
  } else {
    click($$(".option-btn")[q.answer]);
  }
}

function playLesson(lesson: Lesson) {
  for (let i = 0; i < lesson.questions.length; i++) {
    answerCorrectly(lesson.questions[i]);
    click($$(".btn-wide")[0]); // 检查
    const cont = $$(".btn-wide")[0];
    if (cont) click(cont); // 继续
  }
}

/** 首题故意答错(letters 题只点一个字母必然不等于完整答案),其余题答对,进入首次结算。 */
function playLessonFirstWrong(lesson: Lesson) {
  click($$(".tile").filter((t) => !t.className.includes("accent"))[0]);
  click($$(".btn-wide")[0]); // 检查
  click($$(".btn-wide")[0]); // 继续

  for (let i = 1; i < lesson.questions.length; i++) {
    answerCorrectly(lesson.questions[i]);
    click($$(".btn-wide")[0]); // 检查
    click($$(".btn-wide")[0]); // 继续
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

function renderApp() {
  act(() => root.render(<App />));
}

function openFirstLesson() {
  click($$(".chapter-toggle")[0]);
  click($$(".lesson-item")[0]);
}

function navTo(label: string) {
  click($$(".bottom-nav button").find((b) => b.textContent === label));
}

/** 在统计页点一次分享,等待 onShare 的异步状态落定。 */
async function shareFromStats(result: ShareResult) {
  vi.mocked(shareStatsCard).mockResolvedValueOnce(result);
  renderApp();
  navTo("统计");
  expect($$(".stats-share-btn").length).toBe(1);
  click($$(".stats-share-btn")[0]);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(shareStatsCard).toHaveBeenCalledTimes(1);
}

test("结算达标:弹出提醒并写入当天 sharePrompted", () => {
  seed({ dailyGoal: 2 });
  renderApp();
  openFirstLesson();
  playLesson(firstLesson);

  expect($$(".goal-dialog").length).toBe(1);
  expect(container.querySelector(".goal-dialog")?.getAttribute("role")).toBe("dialog");

  const saved = savedProgress();
  const day = saved.days[today()];
  expect(day.xp).toBeGreaterThanOrEqual(2);
  expect(day.sharePrompted).toBe(true);
});

test("同一天再次结算不再弹出提醒", () => {
  seed({ dailyGoal: 2 });
  renderApp();
  openFirstLesson();
  playLesson(firstLesson);
  expect($$(".goal-dialog").length).toBe(1);

  click($$(".goal-dialog .btn-secondary")[0]);
  expect($$(".goal-dialog").length).toBe(0);

  click(
    $$(".settlement-actions .btn-secondary").find((b) =>
      b.textContent?.includes("返回")
    )
  );
  expect($$(".chapter-card").length).toBe(1);

  openFirstLesson();
  playLesson(firstLesson);
  expect($$(".goal-dialog").length).toBe(0);
  expect(savedProgress().days[today()].sharePrompted).toBe(true);
});

test("未达标不弹提醒", () => {
  seed({ dailyGoal: 120 });
  renderApp();
  openFirstLesson();
  playLesson(firstLesson);

  expect(container.textContent).toContain("练习完成");
  expect($$(".goal-dialog").length).toBe(0);
  expect(savedProgress().days[today()].sharePrompted).toBeUndefined();
});

test("今日 XP 恰好等于目标时也触发提醒(>= 边界)", () => {
  // 合成练习一全对结算:3 题 × 2 XP + 过关奖 5 + 全对奖 5 = 16 XP
  const settledXp =
    firstLesson.questions.length * XP_PER_CORRECT +
    XP_LESSON_BONUS +
    XP_PERFECT_BONUS;
  seed({ dailyGoal: settledXp });
  renderApp();
  openFirstLesson();
  playLesson(firstLesson);

  const day = savedProgress().days[today()];
  expect(day.xp).toBe(settledXp);
  expect($$(".goal-dialog").length).toBe(1);
  expect(day.sharePrompted).toBe(true);
});

test("dailyGoal 为 0 时不弹提醒也不写标记", () => {
  seed({ dailyGoal: 0 });
  renderApp();
  openFirstLesson();
  playLesson(firstLesson);

  expect(container.textContent).toContain("练习完成");
  expect($$(".goal-dialog").length).toBe(0);
  expect(savedProgress().days[today()].sharePrompted).toBeUndefined();
});

test("昨天已提示不压制今天:跨天重新提醒", () => {
  const t = today();
  const yesterday = shiftDate(t, -1);
  seed({
    dailyGoal: 2,
    days: {
      [yesterday]: { xp: 2, earnedQids: [], bonusIds: [], sharePrompted: true },
    },
  });
  renderApp();
  openFirstLesson();
  playLesson(firstLesson);

  const saved = savedProgress();
  expect($$(".goal-dialog").length).toBe(1);
  expect(saved.days[t].sharePrompted).toBe(true);
  expect(saved.days[yesterday].sharePrompted).toBe(true);
});

test("复习关结算也能触发提醒", () => {
  const mistakeId = firstLesson.questions[0].id;
  seed({
    dailyGoal: 2,
    mistakes: { [mistakeId]: { lastWrong: "2026-10-27", count: 1 } },
  });
  renderApp();
  click($$(".btn-review")[0]);

  const question = firstLesson.questions[0];
  answerCorrectly(question);
  click($$(".btn-wide")[0]); // 检查
  click($$(".btn-wide")[0]); // 继续 → 结算

  expect(container.textContent).toContain("练习完成");
  expect($$(".goal-dialog").length).toBe(1);
  expect(savedProgress().days[today()].sharePrompted).toBe(true);
});

test("重做补救结算跨过目标时提醒,首次结算不提醒", () => {
  seed({ dailyGoal: 10 });
  renderApp();
  openFirstLesson();
  playLessonFirstWrong(firstLesson);

  // 首次结算:答对 2 题 4 XP + 过关奖 5 = 9 XP,低于目标 10,不提醒
  expect(container.textContent).toContain("练习完成");
  expect(savedProgress().days[today()].xp).toBe(9);
  expect($$(".goal-dialog").length).toBe(0);

  click(
    $$(".settlement-actions .btn-secondary").find((b) =>
      b.textContent?.includes("重做")
    )
  );
  answerCorrectly(firstLesson.questions[0]);
  click($$(".btn-wide")[0]); // 检查
  click($$(".btn-wide")[0]); // 继续 → 重做结算

  // 重做答对 +1、补发全对奖 +5,当天共 15 XP ≥ 10,提醒出现
  const day = savedProgress().days[today()];
  expect(day.xp).toBe(15);
  expect($$(".goal-dialog").length).toBe(1);
  expect(day.sharePrompted).toBe(true);
});

test("统计页手动分享成功后写入当天标记,之后结算不再弹提醒", async () => {
  seed({ dailyGoal: 2 });
  vi.mocked(shareStatsCard).mockResolvedValueOnce({ status: "shared" });
  renderApp();
  navTo("统计");
  expect($$(".stats-share-btn").length).toBe(1);

  click($$(".stats-share-btn")[0]);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(shareStatsCard).toHaveBeenCalledTimes(1);
  const day = savedProgress().days[today()];
  expect(day.sharePrompted).toBe(true);
  expect(day.xp).toBe(0);

  navTo("练习");
  openFirstLesson();
  playLesson(firstLesson);
  expect($$(".goal-dialog").length).toBe(0);
});

test("手动分享 downloaded 也写入当天 sharePrompted(0 XP 允许)", async () => {
  seed({ dailyGoal: 30 });
  await shareFromStats({
    status: "downloaded",
    filename: "fge-stats-2026-11-04.png",
  });

  const day = savedProgress().days[today()];
  expect(day.xp).toBe(0);
  expect(day.sharePrompted).toBe(true);
});

test("手动分享 cancelled 不写当天标记", async () => {
  seed({ dailyGoal: 30 });
  await shareFromStats({ status: "cancelled" });

  expect(savedProgress().days[today()]?.sharePrompted).toBeUndefined();
});

test("手动分享 error 不写当天标记", async () => {
  seed({ dailyGoal: 30 });
  await shareFromStats({ status: "error", message: "分享失败" });

  expect(savedProgress().days[today()]?.sharePrompted).toBeUndefined();
});

test("onSettlement 收到结算后的 Progress(含奖励 XP),且在 onProgress 之后", () => {
  const initial: Progress = { ...DEFAULT_PROGRESS, dailyGoal: 2 };
  const settlements: Progress[] = [];
  const events: string[] = [];

  function Harness() {
    const [progress, setProgress] = useState(initial);
    return (
      <LessonView
        chapter={chapter}
        lesson={firstLesson}
        progress={progress}
        onProgress={(p) => {
          events.push(`progress:${p.xp}`);
          setProgress(p);
        }}
        onExit={() => {}}
        onNextLesson={() => {}}
        onFinish={() => {}}
        onSettlement={(p) => {
          events.push(`settlement:${p.xp}`);
          settlements.push(p);
        }}
      />
    );
  }

  act(() => root.render(<Harness />));
  playLesson(firstLesson);

  const expectedXp =
    firstLesson.questions.length * XP_PER_CORRECT +
    XP_LESSON_BONUS +
    XP_PERFECT_BONUS;

  expect(settlements).toHaveLength(1);
  expect(settlements[0].xp).toBe(expectedXp);
  expect(settlements[0].days[today()].xp).toBe(expectedXp);
  expect(events.slice(-2)).toEqual([
    `progress:${expectedXp}`,
    `settlement:${expectedXp}`,
  ]);
});
