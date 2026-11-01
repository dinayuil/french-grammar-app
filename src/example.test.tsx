import { createRoot, type Root } from "react-dom/client";
import { act, useState } from "react";
import { LessonView } from "./views/LessonView";
import { DEFAULT_PROGRESS } from "./storage";
import { syntheticChapter } from "./test/fixtures";
import type { Chapter, Lesson, Progress } from "./types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const baseLesson = syntheticChapter.lessons[0];
const exampleQuestion = baseLesson.questions[1];
const example = exampleQuestion.example!;
const lesson: Lesson = { ...baseLesson, questions: [exampleQuestion] };
const chapter: Chapter = { ...syntheticChapter, lessons: [lesson], challenges: [] };

let container: HTMLDivElement;
let root: Root;

function Harness() {
  const [progress, setProgress] = useState<Progress>(DEFAULT_PROGRESS);
  return (
    <LessonView
      chapter={chapter}
      lesson={lesson}
      progress={progress}
      onProgress={setProgress}
      onExit={() => {}}
      onNextLesson={() => {}}
      onFinish={() => {}}
    />
  );
}

const $$ = (sel: string) => [...container.querySelectorAll(sel)];

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
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
});

test("范例显示在题干上方,判分后仍然保留", () => {
  act(() => root.render(<Harness />));
  expect(container.textContent).toContain("范例");
  expect(container.textContent).toContain(example);

  const exampleLine = $$(".quiz-example")[0]!;
  const promptLine = $$(".quiz-prompt")[0]!;
  expect(exampleLine.compareDocumentPosition(promptLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  click($$(".option-btn")[0]!);
  click($$(".btn-wide")[0]!);
  expect(container.textContent).toContain(example);
});
