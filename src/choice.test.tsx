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
import { acceptedChoiceIndices } from "./engine";
import type { ChoiceQuestion } from "./types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const chapter = CHAPTERS[0];
const challenge = chapter.challenges[0];
/** answer 0, alternatives [1]:两个选项都是合法答案 */
const altChoice = chapter.lessons[0].questions[1] as ChoiceQuestion;
/** 无 alternatives:只有一个合法答案 */
const plainChoice = challenge.questions[0] as ChoiceQuestion;

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
});

const $$ = (sel: string) => [...container.querySelectorAll(sel)];

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function option(index: number) {
  return $$(".option-btn")[index] as HTMLButtonElement;
}

function clickButton(text: string, selector = "button") {
  const btn = $$(selector).find((b) => b.textContent?.includes(text));
  expect(btn).toBeDefined();
  click(btn!);
}

function clickCheck() {
  clickButton("检查", ".btn-wide");
}

function clickContinue() {
  clickButton("继续", ".btn-wide");
}

function openLesson(title: string) {
  act(() => root.render(<App />));
  click($$(".chapter-toggle")[0]!);
  const item = $$(".lesson-item").find((b) => b.textContent?.includes(title));
  expect(item).toBeDefined();
  click(item!);
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

test("复习关选择题:选中的备选答案判对,所有合法选项标 correct 且无 wrong", () => {
  seed({ mistakes: { [altChoice.id]: { lastWrong: "2026-10-20", count: 3 } } });
  act(() => root.render(<App />));
  click($$(".btn-review")[0]!);
  expect(container.textContent).toContain(altChoice.prompt);

  click(option(1));
  expect($$(".option-btn.selected").length).toBe(1);
  expect($$(".option-btn.correct").length).toBe(0);
  expect($$(".option-btn.wrong").length).toBe(0);

  const feedbackBefore = container.querySelector(".feedback");
  expect(feedbackBefore).not.toBeNull();
  expect(feedbackBefore!.getAttribute("role")).toBe("status");
  expect(feedbackBefore!.getAttribute("aria-live")).toBe("polite");
  expect(feedbackBefore!.getAttribute("aria-atomic")).toBe("true");
  expect(feedbackBefore!.className).toContain("visually-hidden");
  expect(feedbackBefore!.textContent).toBe("");

  clickCheck();

  const feedback = container.querySelector(".feedback");
  expect(feedback).not.toBeNull();
  expect(feedback!.className).not.toContain("visually-hidden");
  expect(feedback!.getAttribute("role")).toBe("status");
  expect(feedback!.getAttribute("aria-live")).toBe("polite");
  expect(feedback!.getAttribute("aria-atomic")).toBe("true");
  expect(feedback!.className).toContain("good");
  expect(feedback!.textContent).toContain("正确");

  expect($$(".option-btn.wrong").length).toBe(0);
  expect($$(".option-btn.correct").length).toBe(2);
  for (const i of acceptedChoiceIndices(altChoice)) {
    expect(option(i).className).toContain("correct");
    expect(option(i).className).not.toContain("wrong");
    expect(option(i).className).not.toContain("selected");
    expect(option(i).querySelector(".option-mark")?.textContent).toBe("✓");
    expect(option(i).getAttribute("aria-label")).toBe(`${altChoice.options[i]}，正确答案`);
  }
  expect(option(1).className).toContain("correct");
  expect(option(1).getAttribute("aria-label")).toBe("sous，正确答案");
  expect(savedProgress().mistakes[altChoice.id]).toBeUndefined();
});

test("答对主答案:仅合法选项标 correct,无 wrong,反馈可被读屏播报", () => {
  openLesson(challenge.title);
  expect(container.textContent).toContain(plainChoice.prompt);

  click(option(plainChoice.answer));
  const feedbackBefore = container.querySelector(".feedback");
  expect(feedbackBefore!.getAttribute("aria-atomic")).toBe("true");
  expect(feedbackBefore!.className).toContain("visually-hidden");
  expect(feedbackBefore!.textContent).toBe("");
  clickCheck();

  const feedback = container.querySelector(".feedback");
  expect(feedback!.className).not.toContain("visually-hidden");
  expect(feedback!.getAttribute("role")).toBe("status");
  expect(feedback!.getAttribute("aria-live")).toBe("polite");
  expect(feedback!.getAttribute("aria-atomic")).toBe("true");
  expect(feedback!.textContent).toContain("正确");

  expect($$(".option-btn.correct").length).toBe(1);
  expect($$(".option-btn.wrong").length).toBe(0);
  expect($$(".option-btn.selected").length).toBe(0);
  const accepted = acceptedChoiceIndices(plainChoice);
  for (let i = 0; i < plainChoice.options.length; i++) {
    if (accepted.has(i)) expect(option(i).className).toContain("correct");
    else expect(option(i).className).not.toContain("correct");
  }
  expect(option(plainChoice.answer).getAttribute("aria-label")).toBe(
    `${plainChoice.options[plainChoice.answer]}，正确答案`
  );
});

test("答错 → 结算 → 重做:重做前不残留上一次的 correct/wrong,重做答对显示正确", () => {
  openLesson(challenge.title);
  const accepted = acceptedChoiceIndices(plainChoice);
  const wrongIndex = plainChoice.options.findIndex((_, i) => !accepted.has(i));
  expect(wrongIndex).toBeGreaterThanOrEqual(0);

  click(option(wrongIndex));
  expect(container.querySelector(".feedback")?.className).toContain("visually-hidden");
  clickCheck();
  expect($$(".option-btn.correct").length).toBe(1);
  expect($$(".option-btn.wrong").length).toBe(1);
  expect(option(wrongIndex).className).not.toContain("selected");
  expect(container.querySelector(".feedback")?.className).not.toContain("visually-hidden");
  expect(container.querySelector(".feedback")?.textContent).toContain("答错了");

  clickContinue();
  expect(container.textContent).toContain("挑战完成");
  clickButton("重做", ".btn-secondary");

  expect(container.textContent).toContain(plainChoice.prompt);
  expect($$(".option-btn.correct").length).toBe(0);
  expect($$(".option-btn.wrong").length).toBe(0);
  expect($$(".option-btn.selected").length).toBe(0);
  const redoFeedback = container.querySelector(".feedback");
  expect(redoFeedback?.className).toContain("visually-hidden");
  expect(redoFeedback?.textContent).toBe("");

  click(option(plainChoice.answer));
  clickCheck();
  expect($$(".option-btn.correct").length).toBe(1);
  expect($$(".option-btn.wrong").length).toBe(0);
  expect(option(plainChoice.answer).className).not.toContain("wrong");
  expect(option(plainChoice.answer).querySelector(".option-mark")?.textContent).toBe("✓");
  expect(container.querySelector(".feedback")?.className).not.toContain("visually-hidden");
  expect(container.querySelector(".feedback")?.textContent).toContain("正确");
});
