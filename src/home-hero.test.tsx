import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import css from "./styles.css?raw";
import { HomeView } from "./views/HomeView";
import { DEFAULT_PROGRESS, today } from "./storage";
import type { DayRecord, Progress } from "./types";
import { syntheticChapter } from "./test/fixtures";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const $ = (sel: string) => container.querySelector(sel);
const $$ = (sel: string) => [...container.querySelectorAll(sel)];

/** 取指定选择器的规则体;精确匹配选择器后的 `{`,避免命中派生规则。 */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`styles.css 中未找到规则: ${selector}`);
  return match[1];
}

function dayRecord(xp: number): DayRecord {
  return { xp, earnedQids: [], bonusIds: [] };
}

function dayOffset(offset: number): string {
  const [y, m, d] = today().split("-").map(Number);
  const date = new Date(y, m - 1, d + offset);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

let container: HTMLDivElement;
let root: Root;

function render(progress: Partial<Progress> = {}) {
  act(() =>
    root.render(
      <HomeView
        chapters={[syntheticChapter]}
        progress={{ ...DEFAULT_PROGRESS, ...progress }}
        onOpenLesson={() => {}}
        onOpenCards={() => {}}
        onOpenReview={() => {}}
      />
    )
  );
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("首页顶部摘要", () => {
  test("第一行用连击 + 今日目标铺满,等级独立成行", () => {
    render({ xp: 145, dailyGoal: 30, days: { [today()]: dayRecord(18) } });

    const hero = $(".home-hero");
    const top = $(".hero-top");
    const goal = $(".hero-goal");
    const level = $(".level-bar");

    expect(hero).not.toBeNull();
    expect(top).not.toBeNull();
    expect(top!.querySelector(".streak-flame")).not.toBeNull();
    expect(top!.querySelector(".hero-goal")).toBe(goal);
    expect(hero!.querySelector(":scope > .level-bar")).toBe(level);
    expect(top!.contains(level)).toBe(false);

    expect(goal!.textContent).toContain("今日目标");
    expect($(".hero-goal-value")!.textContent).toMatch(/18\s*\/\s*30\s*XP/);
    expect($(".hero-goal-note")!.textContent).toBe("还差 12 XP");
    expect($(".level-num")!.textContent).toBe("等级 2");
    expect($(".level-xp")!.textContent).toMatch(/升级经验\s*45\s*\/\s*100\s*XP/);
  });

  test("样式保证首行铺满:网格布局 + 今日目标占剩余宽度 + 长数字可换行", () => {
    expect(ruleBody(".home-hero")).toContain("display: grid");
    expect(ruleBody(".hero-top")).toContain(
      "grid-template-columns: auto minmax(0, 1fr)"
    );
    expect(ruleBody(".hero-goal")).toContain("min-width: 0");
    expect(ruleBody(".hero-goal-value")).toContain("overflow-wrap: anywhere");
    expect(ruleBody(".hero-goal-value")).toContain(
      "font-variant-numeric: tabular-nums"
    );
    expect(ruleBody(".hero-goal-fill")).toContain("background: var(--primary)");
    expect(ruleBody(".hero-goal.is-done .hero-goal-fill")).toContain(
      "background: var(--gold)"
    );
  });

  test("超过今日目标:保留真实 XP,进度封顶,并用金色达成态", () => {
    render({ xp: 250, dailyGoal: 30, days: { [today()]: dayRecord(42) } });

    expect($(".hero-goal")!.className).toContain("is-done");
    expect($(".hero-goal-value")!.textContent).toMatch(/42\s*\/\s*30\s*XP/);
    expect($(".hero-goal-note")!.textContent).toBe("已达成 · 超出 12 XP");
    expect(($(".hero-goal-fill") as HTMLElement).style.width).toBe("100%");
    expect($(".level-num")!.textContent).toBe("等级 3");
    expect($(".level-xp")!.textContent).toMatch(/50\s*\/\s*100\s*XP/);
  });

  test("刚好达到目标:显示达成而不是还差 0 XP", () => {
    render({ xp: 30, dailyGoal: 30, days: { [today()]: dayRecord(30) } });

    expect($(".hero-goal")!.className).toContain("is-done");
    expect($(".hero-goal-value")!.textContent).toMatch(/30\s*\/\s*30\s*XP/);
    expect($(".hero-goal-note")!.textContent).toBe("今日目标已达成");
  });

  test("目标为 0:不出现除零或 NaN,仍展示今日获得 XP", () => {
    render({ xp: 18, dailyGoal: 0, days: { [today()]: dayRecord(18) } });

    expect($(".hero-goal")!.className).toContain("is-unset");
    expect($(".hero-goal-label")!.textContent).toBe("今日获得");
    expect($(".hero-goal-value")!.textContent).toMatch(/18\s*XP/);
    expect($(".hero-goal-note")!.textContent).toBe("尚未设置每日目标");
    expect(($(".hero-goal-fill") as HTMLElement).style.width).toBe("0%");
    expect($(".streak-count")!.textContent).toBe("0");
    expect($(".home-hero")!.textContent).not.toMatch(/NaN|Infinity/);
  });

  test("12 天连击与较大 XP 不丢数据、不产生非法文本", () => {
    const days: Record<string, DayRecord> = {};
    for (let offset = -11; offset <= 0; offset++) {
      days[dayOffset(offset)] = dayRecord(offset === 0 ? 98765 : 120);
    }
    render({ xp: 123456789, dailyGoal: 120, days });

    expect($$(".streak-flame").length).toBe(1);
    expect($(".streak-count")!.textContent).toBe("12");
    expect($(".hero-goal-value")!.textContent).toMatch(/98765\s*\/\s*120\s*XP/);
    expect($(".hero-goal-note")!.textContent).toBe("已达成 · 超出 98645 XP");
    expect($(".level-num")!.textContent).toMatch(/^等级 \d+$/);
    expect($(".home-hero")!.textContent).not.toMatch(/NaN|Infinity/);
  });
});
