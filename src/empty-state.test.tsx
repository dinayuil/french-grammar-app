import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import App from "./App";
import { HomeView } from "./views/HomeView";
import { DEFAULT_PROGRESS } from "./storage";
import { STORAGE_KEY } from "./config";
import type { Chapter, Progress } from "./types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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
  localStorage.clear();
});

const $$ = (s: string) => [...container.querySelectorAll(s)];
const $ = (s: string) => container.querySelector(s);

function click(el: Element | null) {
  if (!el) throw new Error("element not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function renderApp() {
  act(() => root.render(<App />));
}

function renderHomeView(props: {
  chapters: Chapter[];
  progress: Progress;
  onOpenLesson?: (chapterId: string, lessonId: string) => void;
  onOpenCards?: (chapterId: string) => void;
  onOpenReview?: () => void;
}) {
  act(() =>
    root.render(
      <HomeView
        chapters={props.chapters}
        progress={props.progress}
        onOpenLesson={props.onOpenLesson ?? vi.fn()}
        onOpenCards={props.onOpenCards ?? vi.fn()}
        onOpenReview={props.onOpenReview ?? vi.fn()}
      />
    )
  );
}

const syntheticChapter: Chapter = {
  id: "ch-synthetic",
  title: "合成章节",
  titleFr: "Chapitre synthétique",
  cards: [],
  lessons: [
    {
      id: "les-synthetic-1",
      title: "合成关卡",
      kind: "lesson",
      source: "test",
      questions: [
        {
          id: "q-synthetic-1",
          prompt: "测试题干",
          explain: "测试讲解",
          type: "choice",
          options: ["A", "B"],
          answer: 0,
        },
      ],
    },
  ],
  challenges: [],
};

describe("HomeView 空 chapters(与 edition 无关)", () => {
  test("空 chapters:固定文案、无章节卡、复习禁用且不触发回调", () => {
    const onOpenReview = vi.fn();
    renderHomeView({ chapters: [], progress: DEFAULT_PROGRESS, onOpenReview });
    expect(container.textContent).toContain("原创题库正在准备中");
    expect($$(".chapter-card").length).toBe(0);
    const reviewBtn = $(".btn-review") as HTMLButtonElement | null;
    expect(reviewBtn).not.toBeNull();
    expect(reviewBtn!.disabled).toBe(true);
    click(reviewBtn);
    expect(onOpenReview).not.toHaveBeenCalled();
  });
});

describe.skipIf(__FGE_EDITION__ !== "public")("空题库公开首页", () => {
  test("公开零章节可启动并显示固定文案", () => {
    renderApp();
    expect(container.textContent).toContain("原创题库正在准备中");
    expect($$(".chapter-card").length).toBe(0);
  });

  test("没有可启动练习时复习按钮禁用", () => {
    renderApp();
    const reviewBtn = $(".btn-review") as HTMLButtonElement | null;
    expect(reviewBtn).not.toBeNull();
    expect(reviewBtn!.disabled).toBe(true);
  });

  test("存在未知旧错题时复习按钮仍禁用且不进入空练习", () => {
    const stale: Progress = {
      ...DEFAULT_PROGRESS,
      mistakes: {
        "stale-unknown-qid": { lastWrong: "2026-01-01", count: 3 },
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stale));
    renderApp();
    const reviewBtn = $(".btn-review") as HTMLButtonElement | null;
    expect(reviewBtn).not.toBeNull();
    expect(reviewBtn!.disabled).toBe(true);
    expect($$(".review-count").length).toBe(0);
    click(reviewBtn);
    // 仍在首页空状态,没有进入复习或关卡页
    expect(container.textContent).toContain("原创题库正在准备中");
    expect($$(".lesson").length).toBe(0);
  });

  test("统计和设置切换正常,设置保存后回主页不崩溃", () => {
    renderApp();
    const statsNav = [...$$(".nav-item")].find((el) => el.textContent?.includes("统计"));
    click(statsNav ?? null);
    expect($$(".stats").length).toBe(1);

    const homeNav = [...$$(".nav-item")].find((el) => el.textContent?.includes("练习"));
    click(homeNav ?? null);
    expect(container.textContent).toContain("原创题库正在准备中");

    const settingsNav = [...$$(".nav-item")].find((el) => el.textContent?.includes("设置"));
    click(settingsNav ?? null);
    expect($$(".settings").length).toBe(1);

    const goal120 = [...$$(".option-btn")].find((el) => el.textContent?.includes("120 XP"));
    click(goal120 ?? null);
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(saved.dailyGoal).toBe(120);

    click(homeNav ?? null);
    expect(container.textContent).toContain("原创题库正在准备中");
    expect($$(".chapter-card").length).toBe(0);
  });
});

describe("有题模式下功能不被禁用", () => {
  test("非空章节可展开并启动关卡", () => {
    const onOpenLesson = vi.fn();
    renderHomeView({ chapters: [syntheticChapter], progress: DEFAULT_PROGRESS, onOpenLesson });
    expect($$(".chapter-card").length).toBe(1);
    expect(container.textContent).toContain("合成章节");

    click($(".chapter-toggle"));
    const lessonBtn = $(".lesson-item");
    expect(lessonBtn).not.toBeNull();
    expect(lessonBtn!.textContent).toContain("合成关卡");

    click(lessonBtn);
    expect(onOpenLesson).toHaveBeenCalledWith("ch-synthetic", "les-synthetic-1");
  });

  test("错题 ID 对应现有题目时复习按钮可用", () => {
    const onOpenReview = vi.fn();
    const progress: Progress = {
      ...DEFAULT_PROGRESS,
      mistakes: {
        "q-synthetic-1": { lastWrong: "2026-01-01", count: 1 },
      },
    };
    renderHomeView({
      chapters: [syntheticChapter],
      progress,
      onOpenReview,
    });
    const reviewBtn = $(".btn-review") as HTMLButtonElement | null;
    expect(reviewBtn).not.toBeNull();
    expect(reviewBtn!.disabled).toBe(false);
    expect($$(".review-count").length).toBe(1);
    click(reviewBtn);
    expect(onOpenReview).toHaveBeenCalled();
  });
});
