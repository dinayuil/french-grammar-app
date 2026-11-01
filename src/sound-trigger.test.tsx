import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { vi } from "vitest";

vi.mock("virtual:fge-content", async () => {
  const { syntheticChapter } = await import("./test/fixtures");
  return { CHAPTERS: [syntheticChapter] };
});

vi.mock("./sound", () => ({ playSound: vi.fn() }));

import App from "./App";
import { STORAGE_KEY } from "./config";
import { playSound } from "./sound";
import { syntheticChapter } from "./test/fixtures";
import type { Question } from "./types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const sound = vi.mocked(playSound);
const firstLesson = syntheticChapter.lessons[0];
const firstQuestion = firstLesson.questions[0];
const reviewMistake = { [firstQuestion.id]: { lastWrong: "2026-10-27", count: 1 } };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  sound.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const $$ = (sel: string) => [...container.querySelectorAll(sel)];

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

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

function seed(partial: Record<string, unknown>) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ xp: 0, dailyGoal: 30, days: {}, lessons: {}, mistakes: {}, ...partial })
  );
}

function openReview() {
  act(() => root.render(<App />));
  click($$(".btn-review")[0]!);
}

test("答对触发 correct", () => {
  act(() => root.render(<App />));
  click($$(".chapter-toggle")[0]!);
  click($$(".lesson-item")[0]!);
  answerCorrectly(firstQuestion);
  click($$(".btn-wide")[0]!);
  expect(sound).toHaveBeenCalledWith("correct", true);
});

test("答错触发 wrong", () => {
  act(() => root.render(<App />));
  click($$(".chapter-toggle")[0]!);
  click($$(".lesson-item")[0]!);
  // 只点一个字母就提交,必然答错
  click($$(".tile").filter((t) => !t.className.includes("accent"))[0]!);
  click($$(".btn-wide")[0]!);
  expect(sound).toHaveBeenCalledWith("wrong", true);
});

test("进入结算触发 complete,重做后再次结算再响一次", () => {
  seed({ mistakes: reviewMistake });
  openReview();
  click($$(".tile").filter((t) => !t.className.includes("accent"))[0]!);
  click($$(".btn-wide")[0]!); // 检查
  click($$(".btn-wide")[0]!); // 继续 → 结算
  expect(sound.mock.calls.filter((c) => c[0] === "complete")).toHaveLength(1);

  click($$(".btn-secondary").filter((b) => b.textContent?.includes("重做"))[0]!);
  answerCorrectly(firstQuestion);
  click($$(".btn-wide")[0]!);
  click($$(".btn-wide")[0]!);
  expect(sound.mock.calls.filter((c) => c[0] === "complete")).toHaveLength(2);
});

test("答题 XP 跨级:升级音只响一次,结算不重复", () => {
  seed({ xp: 99, mistakes: reviewMistake });
  openReview();
  answerCorrectly(firstQuestion);
  click($$(".btn-wide")[0]!); // 检查 → 101 XP
  expect(sound).toHaveBeenCalledWith("levelup", true, 0.35);

  click($$(".btn-wide")[0]!); // 继续 → 结算
  expect(sound.mock.calls.filter((c) => c[0] === "levelup")).toHaveLength(1);
});

test("结算奖励跨级:过关音后补升级音", () => {
  seed({ xp: 90, mistakes: reviewMistake });
  openReview();
  answerCorrectly(firstQuestion);
  click($$(".btn-wide")[0]!); // 检查 → 92 XP
  expect(sound.mock.calls.filter((c) => c[0] === "levelup")).toHaveLength(0);

  click($$(".btn-wide")[0]!); // 继续 → 102 XP
  expect(sound).toHaveBeenCalledWith("levelup", true, 0.5);
});

test("关闭音效:答对、升级、过关全部静音", () => {
  seed({ sound: false, xp: 99, mistakes: reviewMistake });
  openReview();
  answerCorrectly(firstQuestion);
  click($$(".btn-wide")[0]!); // 检查 → correct + levelup
  click($$(".btn-wide")[0]!); // 继续 → complete

  expect(sound.mock.calls.length).toBeGreaterThanOrEqual(3);
  expect(sound.mock.calls.map((c) => c[0]).sort()).toEqual(["complete", "correct", "levelup"]);
  expect(sound.mock.calls.every((c) => c[1] === false)).toBe(true);
});

test("关闭音效:重做结算也静音", () => {
  seed({ sound: false, mistakes: reviewMistake });
  openReview();
  click($$(".tile").filter((t) => !t.className.includes("accent"))[0]!); // 答错
  click($$(".btn-wide")[0]!); // 检查
  click($$(".btn-wide")[0]!); // 继续 → 首次结算
  click($$(".btn-secondary").filter((b) => b.textContent?.includes("重做"))[0]!);
  answerCorrectly(firstQuestion);
  click($$(".btn-wide")[0]!); // 检查
  click($$(".btn-wide")[0]!); // 继续 → 重做后结算

  expect(sound.mock.calls.filter((c) => c[0] === "complete")).toHaveLength(2);
  expect(sound.mock.calls.every((c) => c[1] === false)).toBe(true);
});
