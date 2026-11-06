import { createRoot, type Root } from "react-dom/client";
import { act, useState } from "react";
import { LessonView } from "./views/LessonView";
import { SettingsView } from "./views/SettingsView";
import { DEFAULT_PROGRESS } from "./storage";
import { syntheticChapter } from "./test/fixtures";
import type { Chapter, ChoiceQuestion, Lesson, Progress, TilesQuestion } from "./types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const baseLesson = syntheticChapter.lessons[0];
const choiceQuestion = baseLesson.questions[1] as ChoiceQuestion;
const tilesQuestion = baseLesson.questions[2] as TilesQuestion;

const choiceLesson: Lesson = { ...baseLesson, id: "l-choice", questions: [choiceQuestion] };
const tilesLesson: Lesson = { ...baseLesson, id: "l-tiles", questions: [tilesQuestion] };

function chapterFor(lesson: Lesson): Chapter {
  return {
    id: "test",
    title: "测试",
    titleFr: "Test",
    cards: [],
    lessons: [lesson],
    challenges: [],
  };
}

function LessonHarness({ initial, lesson }: { initial: Progress; lesson: Lesson }) {
  const [progress, setProgress] = useState(initial);
  return (
    <LessonView
      chapter={chapterFor(lesson)}
      lesson={lesson}
      progress={progress}
      onProgress={setProgress}
      onExit={() => {}}
      onNextLesson={() => {}}
      onFinish={() => {}}
    />
  );
}

function SettingsHarness({ initial }: { initial: Progress }) {
  const [progress, setProgress] = useState(initial);
  return <SettingsView progress={progress} onChange={setProgress} />;
}

const $$ = (sel: string) => [...container.querySelectorAll(sel)];

function click(el: Element) {
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
});

const afterProgress: Progress = { ...DEFAULT_PROGRESS };
const beforeProgress: Progress = { ...DEFAULT_PROGRESS, translationTiming: "before" };
const offProgress: Progress = { ...DEFAULT_PROGRESS, translationEnabled: false };

test("默认答题后:答题前不显示翻译,判分后显示翻译并补全题干", () => {
  act(() => root.render(<LessonHarness initial={afterProgress} lesson={choiceLesson} />));
  expect(container.textContent).not.toContain(choiceQuestion.translation!);
  expect(container.textContent).toContain(choiceQuestion.prompt);

  click($$(".option-btn")[0]!);
  click($$(".btn-wide")[0]!);

  expect(container.textContent).toContain(choiceQuestion.translation!);
  expect(container.textContent).toContain("La clé est sur la petite table.");
  expect(container.textContent).not.toContain(choiceQuestion.prompt);
});

test("答题前模式:答题前就显示翻译,判分后仍保留", () => {
  act(() => root.render(<LessonHarness initial={beforeProgress} lesson={choiceLesson} />));
  expect(container.textContent).toContain(choiceQuestion.translation!);
  click($$(".option-btn")[0]!);
  click($$(".btn-wide")[0]!);
  expect(container.textContent).toContain(choiceQuestion.translation!);
});

test("关闭翻译:判分前后都不显示", () => {
  act(() => root.render(<LessonHarness initial={offProgress} lesson={choiceLesson} />));
  expect(container.textContent).not.toContain(choiceQuestion.translation!);
  click($$(".option-btn")[0]!);
  click($$(".btn-wide")[0]!);
  expect(container.textContent).not.toContain(choiceQuestion.translation!);
});

test("词块题判分后显示完整目标句和翻译", () => {
  act(() => root.render(<LessonHarness initial={afterProgress} lesson={tilesLesson} />));
  for (const w of tilesQuestion.answer) {
    const tile = $$(".letter-tiles .tile").find((t) => t.textContent === w)!;
    click(tile);
  }
  click($$(".btn-wide")[0]!);
  expect(container.textContent).toContain(tilesQuestion.answer.join(" "));
  expect(container.textContent).toContain(tilesQuestion.translation!);
});

test("设置页:关闭翻译时时机禁用,开启后可选择答题前", () => {
  act(() => root.render(<SettingsHarness initial={DEFAULT_PROGRESS} />));
  click($$(".option-btn").find((b) => b.textContent === "关闭翻译")!);
  expect((($$(".option-btn").find((b) => b.textContent === "答题前显示")!) as HTMLButtonElement).disabled).toBe(true);

  click($$(".option-btn").find((b) => b.textContent === "开启翻译")!);
  click($$(".option-btn").find((b) => b.textContent === "答题前显示")!);
  expect($$(".option-btn").find((b) => b.textContent === "答题前显示")!.className).toContain("selected");
});
