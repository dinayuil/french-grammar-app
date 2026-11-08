import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { StatsView } from "./views/StatsView";
import { today } from "./storage";
import type { Progress } from "./types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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

const base: Progress = {
  xp: 0,
  dailyGoal: 10,
  sound: false,
  translationEnabled: true,
  translationTiming: "before",
  days: {},
  lessons: {},
  mistakes: {},
};

function render(progress: Progress) {
  act(() => root.render(<StatsView progress={progress} />));
}

describe("StatsView 学习时长", () => {
  test("有数据时渲染堆叠柱、图例与累计", () => {
    const d = today();
    render({
      ...base,
      days: {
        [d]: {
          xp: 0,
          earnedQids: [],
          bonusIds: [],
          readSeconds: 600,
          practiceSeconds: 300,
        },
      },
    });
    expect(container.textContent).toContain("最近 7 天学习时长");
    expect(container.textContent).toContain("看讲解");
    expect(container.textContent).toContain("累计学习时长");

    const tracks = container.querySelectorAll(".study-bars .bar-track");
    expect(tracks.length).toBe(7);

    const todayTrack = container.querySelector(".study-bars .bar-label-today")?.parentElement;
    expect(todayTrack).not.toBeNull();
    const segs = todayTrack!.querySelectorAll(".study-seg");
    expect(segs.length).toBe(2);
    expect(segs[0].classList.contains("study-practice")).toBe(true);
    expect(segs[1].classList.contains("study-read")).toBe(true);

    expect(container.textContent).toContain("累计学习时长 15 分（看讲解 10 分 / 做练习 5 分）");
  });

  test("全为 0 时不显示柱顶数字、不报错", () => {
    render(base);
    expect(container.textContent).toContain("最近 7 天学习时长");
    expect(container.querySelector(".study-seg")).not.toBeNull();
    expect(container.querySelector(".study-bars .bar-num")?.textContent).toBe("");
  });
});
