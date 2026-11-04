import { describe, expect, test, vi } from "vitest";
import { DEFAULT_PROGRESS, shiftDate } from "../storage";
import type { DayRecord, Progress } from "../types";
import {
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  buildStatsCardData,
  createStatsCardCanvas,
  drawStatsCard,
  statsCardFilename,
} from "./statsCard";

const DATE = "2026-11-04";

const day = (xp: number): DayRecord => ({ xp, earnedQids: [], bonusIds: [] });

function progressWith(over: Partial<Progress> = {}): Progress {
  return { ...DEFAULT_PROGRESS, ...over };
}

/** 今天 42(达标)、昨天 0、前天 12,其余 5 天均有数据。 */
function weekProgress(over: Partial<Progress> = {}): Progress {
  return progressWith({
    xp: 420,
    dailyGoal: 30,
    days: {
      [shiftDate(DATE, -6)]: day(9),
      [shiftDate(DATE, -5)]: day(20),
      [shiftDate(DATE, -4)]: day(5),
      [shiftDate(DATE, -3)]: day(7),
      [shiftDate(DATE, -2)]: day(12),
      [shiftDate(DATE, -1)]: day(0),
      [DATE]: day(42),
    },
    ...over,
  });
}

interface RecordedText {
  text: string;
  x: number;
  y: number;
}

interface RecordedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  style: string;
}

interface RecordedRoundRect extends RecordedRect {
  radius: number;
}

/**
 * jsdom 没有 Canvas 2D,这里用记录调用的假 ctx 验证绘制意图。
 * roundRect 在调用时快照 fillStyle,便于区分轨道与填充。
 */
function fakeCtx() {
  const texts: RecordedText[] = [];
  const fillRects: RecordedRect[] = [];
  const roundRects: RecordedRoundRect[] = [];
  const gradientStops: Array<{ offset: number; color: string }> = [];
  const ctx = {
    fillStyle: "#000000",
    font: "",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
    fillRect(x: number, y: number, width: number, height: number) {
      fillRects.push({ x, y, width, height, style: String(ctx.fillStyle) });
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y });
    },
    createLinearGradient() {
      return {
        addColorStop(offset: number, color: string) {
          gradientStops.push({ offset, color });
        },
      };
    },
    beginPath() {},
    moveTo() {},
    arcTo() {},
    closePath() {},
    roundRect(x: number, y: number, width: number, height: number, radius: number) {
      roundRects.push({ x, y, width, height, radius, style: String(ctx.fillStyle) });
    },
    fill() {},
  };
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    texts,
    fillRects,
    roundRects,
    gradientStops,
  };
}

describe("buildStatsCardData", () => {
  test("汇总今日 XP、目标百分比、7 天顺序、等级与连击", () => {
    const data = buildStatsCardData(weekProgress(), DATE);

    expect(data.date).toBe(DATE);
    expect(data.dateLabel).toBe("2026年11月4日");
    expect(data.todayXp).toBe(42);
    expect(data.goal).toBe(30);
    expect(data.goalPercent).toBe(100);
    expect(data.streak).toBe(1);
    expect(data.level).toBe(5);
    expect(data.totalXp).toBe(420);
    expect(data.days).toHaveLength(7);
    expect(data.days[0]).toMatchObject({
      date: shiftDate(DATE, -6),
      label: "10/29",
      xp: 9,
      isToday: false,
    });
    expect(data.days[6]).toMatchObject({
      date: DATE,
      label: "今天",
      xp: 42,
      isToday: true,
    });
    expect(data.maxXp).toBe(42);
  });

  test("dailyGoal=0 → 目标百分比为 0、连击为 0,不挂起", () => {
    const data = buildStatsCardData(weekProgress({ dailyGoal: 0 }), DATE);

    expect(data.goalPercent).toBe(0);
    expect(data.streak).toBe(0);

    const { ctx, texts } = fakeCtx();
    drawStatsCard(ctx, data);
    const labels = texts.map((t) => t.text);
    expect(labels).toContain("未设置每日目标");
    expect(labels.some((text) => text.startsWith("目标 "))).toBe(false);
  });

  test("7 天全 0 → maxXp 为 1,绘制不抛错", () => {
    const data = buildStatsCardData(progressWith({ days: {} }), DATE);

    expect(data.todayXp).toBe(0);
    expect(data.goalPercent).toBe(0);
    expect(data.maxXp).toBe(1);
    expect(data.days.every((d) => d.xp === 0)).toBe(true);
    expect(() => drawStatsCard(fakeCtx().ctx, data)).not.toThrow();
  });
});

describe("drawStatsCard", () => {
  test("绘制品牌文案、关键指标与 7 根柱子,0 值不画数值", () => {
    const data = buildStatsCardData(weekProgress(), DATE);
    const { ctx, texts, fillRects, roundRects, gradientStops } = fakeCtx();

    drawStatsCard(ctx, data);

    const labels = texts.map((t) => t.text);
    for (const required of [
      "法语语法练习",
      "2026年11月4日",
      "今日 XP",
      "连击天数",
      "等级",
      "累计 XP",
      "今天",
    ]) {
      expect(labels).toContain(required);
    }
    expect(labels).toContain("42");
    expect(labels).toContain("12");
    expect(labels).not.toContain("0");

    expect(gradientStops.map((s) => s.color)).toEqual(["#f0fff0", "#e8ffd6"]);
    expect(
      fillRects.some((r) => r.width === SHARE_CARD_WIDTH && r.height === SHARE_CARD_HEIGHT)
    ).toBe(true);

    const barShapes = roundRects.filter((r) => r.width === 108);
    expect(barShapes).toHaveLength(14); // 7 个轨道 + 7 个填充
    const chartHeight = Math.max(...barShapes.map((r) => r.height));
    expect(barShapes.filter((r) => r.style === "#e5e5e5" && r.height === chartHeight)).toHaveLength(7);

    const fills = barShapes.filter((r) => r.style !== "#e5e5e5");
    expect(fills).toHaveLength(7);
    expect(fills.filter((r) => r.height === 2)).toHaveLength(1); // 昨天 0 XP 仍有 2px
    expect(fills.find((r) => r.style === "#ffc800")?.height).toBe(chartHeight);
    expect(
      fills.some((r) => Math.abs(r.height - (12 / data.maxXp) * chartHeight) < 1e-6)
    ).toBe(true);
  });
});

describe("statsCardFilename", () => {
  test("按日期生成固定 PNG 文件名", () => {
    expect(statsCardFilename("2026-11-04")).toBe("fge-stats-2026-11-04.png");
  });
});

describe("createStatsCardCanvas", () => {
  test("2D 上下文不可用时抛出明确错误", () => {
    const data = buildStatsCardData(weekProgress(), DATE);
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    try {
      expect(() => createStatsCardCanvas(data)).toThrow("Canvas 2D unavailable");
    } finally {
      spy.mockRestore();
    }
  });
});
