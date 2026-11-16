import { describe, expect, test, vi } from "vitest";
import { sharingFr } from "../i18n/sharing.fr";
import { sharingZhCN } from "../i18n/sharing.zh-CN";
import type { UiLocale } from "../i18n/types";
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
const CJK = /[\u3400-\u9fff]/;
const CHART_TOP = 880;
const CHART_LABEL_Y = 1182;
const TIME_CHART_TOP = 828;
const TIME_CHART_BOTTOM = 1048;
const BOTH_XP_CHART_TOP = 706;
const BOTH_XP_CHART_BOTTOM = 814;
const BOTH_STUDY_CHART_TOP = 972;
const BOTH_STUDY_CHART_BOTTOM = 1086;

const day = (xp: number): DayRecord => ({ xp, earnedQids: [], bonusIds: [] });

const studyDay = (xp: number, readSeconds: number, practiceSeconds: number): DayRecord => ({
  ...day(xp),
  readSeconds,
  practiceSeconds,
});

function progressWith(over: Partial<Progress> = {}): Progress {
  return { ...DEFAULT_PROGRESS, ...over };
}

/** 今天 42(达标)、昨天 0、前天 12,其余 5 天均有数据。 */
function weekProgress(over: Partial<Progress> = {}): Progress {
  return progressWith({
    xp: 420,
    dailyGoal: 30,
    shareCardContent: "xp",
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

/**
 * 学习时长周:今天 25 分(看讲解 10 / 做练习 15)、昨天 60 分、前天 20 分。
 * 多放一条 30 天前的 50 分钟阅读,用于区分「近七天」与「累计」。
 */
function studyWeekProgress(over: Partial<Progress> = {}): Progress {
  return progressWith({
    xp: 1200,
    dailyGoal: 60,
    shareCardContent: "time",
    days: {
      [shiftDate(DATE, -30)]: studyDay(0, 3000, 0),
      [shiftDate(DATE, -6)]: studyDay(0, 0, 30),
      [shiftDate(DATE, -5)]: studyDay(10, 60, 0),
      [shiftDate(DATE, -4)]: studyDay(0, 0, 0),
      [shiftDate(DATE, -3)]: studyDay(20, 300, 300),
      [shiftDate(DATE, -2)]: studyDay(10, 1200, 0),
      [shiftDate(DATE, -1)]: studyDay(90, 0, 3600),
      [DATE]: studyDay(42, 600, 900),
    },
    ...over,
  });
}

interface RecordedText {
  text: string;
  x: number;
  y: number;
  font: string;
  style: string;
  align: string;
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

interface FakeOptions {
  withRoundRect?: boolean;
  locale?: UiLocale;
}

/** 测试自己的字宽模型:与实现无关,用于验证缩放后的文字确实放得下。 */
function testTextWidth(text: string, font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  const size = match ? Number(match[1]) : 10;
  return Array.from(text).reduce((width, char) => {
    const wide = char.charCodeAt(0) > 0xff;
    return width + size * (wide ? 1 : 0.6);
  }, 0);
}

function fontSizeOf(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  return match ? Number(match[1]) : 0;
}

/** Intl 法语单位会插入 U+00A0 / U+202F，断言时按普通空白比较。 */
function normalizeSpaces(text: string): string {
  return text.replace(/[\s\u00a0\u202f]+/g, " ").trim();
}

/**
 * jsdom 没有 Canvas 2D,这里用记录调用的假 ctx 验证绘制意图。
 * roundRect 在调用时快照 fillStyle 与 font,便于区分配色与字体层级。
 */
function fakeCtx(options: FakeOptions = {}) {
  const texts: RecordedText[] = [];
  const fillRects: RecordedRect[] = [];
  const roundRects: RecordedRoundRect[] = [];
  const gradientStops: Array<{ offset: number; color: string }> = [];
  let arcToCalls = 0;

  const ctx: Record<string, unknown> = {
    fillStyle: "#000000",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillRect(x: number, y: number, width: number, height: number) {
      fillRects.push({ x, y, width, height, style: String(ctx.fillStyle) });
    },
    fillText(text: string, x: number, y: number) {
      texts.push({
        text,
        x,
        y,
        font: String(ctx.font),
        style: String(ctx.fillStyle),
        align: String(ctx.textAlign),
      });
    },
    measureText(text: string) {
      return { width: testTextWidth(text, String(ctx.font)) } as TextMetrics;
    },
    createLinearGradient() {
      return {
        addColorStop(offset: number, color: string) {
          gradientStops.push({ offset, color });
        },
      } as CanvasGradient;
    },
    beginPath() {},
    moveTo(_x: number, _y: number) {},
    arcTo(
      _x1: number,
      _y1: number,
      _x2: number,
      _y2: number,
      _radius: number
    ) {
      arcToCalls += 1;
    },
    closePath() {},
    fill() {},
  };

  if (options.withRoundRect !== false) {
    ctx.roundRect = (
      x: number,
      y: number,
      width: number,
      height: number,
      radius: number
    ) => {
      roundRects.push({ x, y, width, height, radius, style: String(ctx.fillStyle) });
    };
  }

  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    texts,
    fillRects,
    roundRects,
    gradientStops,
    arcToCalls: () => arcToCalls,
  };
}

function drawCard(progress: Progress, options: FakeOptions = {}) {
  const { locale = "zh-CN", ...fakeOptions } = options;
  const data = buildStatsCardData(progress, DATE, locale);
  const fake = fakeCtx(fakeOptions);
  drawStatsCard(fake.ctx, data);
  return { ...fake, data };
}

function drawWeek(progress: Progress = weekProgress(), locale: UiLocale = "zh-CN") {
  return drawCard(progress, { locale });
}

function textAt(texts: RecordedText[], text: string, y?: number): RecordedText {
  const found = texts.find((item) => item.text === text && (y === undefined || item.y === y));
  if (!found) throw new Error(`未绘制文字: ${text}${y === undefined ? "" : ` @${y}`}`);
  return found;
}

interface TextBounds {
  left: number;
  right: number;
  width: number;
}

/** 按测试字宽模型还原文字占位，用于检查标题、图例与长句不越界或重叠。 */
function boundsOf(item: RecordedText): TextBounds {
  const width = testTextWidth(item.text, item.font);
  if (item.align === "center") {
    return { left: item.x - width / 2, right: item.x + width / 2, width };
  }
  if (item.align === "right") {
    return { left: item.x - width, right: item.x, width };
  }
  return { left: item.x, right: item.x + width, width };
}

function expectFits(item: RecordedText, maxWidth: number): void {
  expect(testTextWidth(item.text, item.font), item.text).toBeLessThanOrEqual(
    maxWidth + 0.5
  );
}

describe("buildStatsCardData", () => {
  test("汇总今日 XP、目标百分比、7 天顺序、等级与连击", () => {
    const data = buildStatsCardData(weekProgress(), DATE);

    expect(data.date).toBe(DATE);
    expect(data.locale).toBe("zh-CN");
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
      label: "11/4",
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

describe("buildStatsCardData 分享内容与学习时长", () => {
  test("读取 shareCardContent,缺失或非法值回退 both", () => {
    expect(buildStatsCardData(weekProgress(), DATE).mode).toBe("xp");
    expect(
      buildStatsCardData(studyWeekProgress(), DATE).mode
    ).toBe("time");
    expect(
      buildStatsCardData(weekProgress({ shareCardContent: "both" }), DATE).mode
    ).toBe("both");

    const legacy = { ...weekProgress() } as Partial<Progress>;
    delete legacy.shareCardContent;
    expect(buildStatsCardData(legacy as Progress, DATE).mode).toBe("both");

    for (const invalid of ["video", "", null, 1, true]) {
      const progress = {
        ...weekProgress(),
        shareCardContent: invalid,
      } as unknown as Progress;
      expect(buildStatsCardData(progress, DATE).mode).toBe("both");
    }
  });

  test("今日与近七天分别汇总阅读、做题秒数,累计包含七天外历史", () => {
    const data = buildStatsCardData(studyWeekProgress(), DATE);

    expect(data.todayXp).toBe(42);
    expect(data.todayRead).toBe(600);
    expect(data.todayPractice).toBe(900);
    expect(data.todayStudy).toBe(1500);
    expect(data.studyRead).toBe(5160);
    expect(data.studyPractice).toBe(4830);
    expect(data.studyTotal).toBe(9990);
    expect(data.maxStudy).toBe(3600);

    expect(data.days).toHaveLength(7);
    expect(data.days[0]).toMatchObject({
      date: shiftDate(DATE, -6),
      readSeconds: 0,
      practiceSeconds: 30,
      studySeconds: 30,
    });
    expect(data.days[6]).toMatchObject({
      date: DATE,
      label: "11/4",
      readSeconds: 600,
      practiceSeconds: 900,
      studySeconds: 1500,
    });
  });

  test("缺失、非数字与损坏记录的学习时长按 0,不根据 XP 推算", () => {
    const progress = progressWith({
      xp: 99999,
      shareCardContent: "time",
      days: {
        [DATE]: day(500),
        [shiftDate(DATE, -1)]: {
          xp: 20,
          readSeconds: Number.NaN,
          practiceSeconds: "900",
        } as unknown as DayRecord,
        [shiftDate(DATE, -2)]: null as unknown as DayRecord,
        [shiftDate(DATE, -30)]: { xp: 10 } as DayRecord,
      },
    });
    const data = buildStatsCardData(progress, DATE);

    expect(data.todayXp).toBe(500);
    expect(data.todayStudy).toBe(0);
    expect(data.studyTotal).toBe(0);
    expect(data.maxStudy).toBe(1);
    expect(data.days.every((d) => d.studySeconds === 0)).toBe(true);
    expect(() => drawStatsCard(fakeCtx().ctx, data)).not.toThrow();
  });

  test("locale 写入数据，法语长日期与短日期用 Intl，数值事实不变", () => {
    const zh = buildStatsCardData(studyWeekProgress(), DATE);
    const fr = buildStatsCardData(studyWeekProgress(), DATE, "fr");

    expect(fr.locale).toBe("fr");
    expect(fr.dateLabel).toBe("4 novembre 2026");
    expect(fr.days[0].label).toBe("29/10");
    expect(fr.days[6].label).toBe("04/11");

    expect(fr.date).toBe(zh.date);
    expect(fr.mode).toBe(zh.mode);
    expect(fr.todayXp).toBe(zh.todayXp);
    expect(fr.goal).toBe(zh.goal);
    expect(fr.goalPercent).toBe(zh.goalPercent);
    expect(fr.streak).toBe(zh.streak);
    expect(fr.level).toBe(zh.level);
    expect(fr.totalXp).toBe(zh.totalXp);
    expect(fr.todayRead).toBe(zh.todayRead);
    expect(fr.todayPractice).toBe(zh.todayPractice);
    expect(fr.todayStudy).toBe(zh.todayStudy);
    expect(fr.studyRead).toBe(zh.studyRead);
    expect(fr.studyPractice).toBe(zh.studyPractice);
    expect(fr.studyTotal).toBe(zh.studyTotal);
    expect(fr.maxXp).toBe(zh.maxXp);
    expect(fr.maxStudy).toBe(zh.maxStudy);
    expect(fr.days.map(({ label: _label, ...dayData }) => dayData)).toEqual(
      zh.days.map(({ label: _label, ...dayData }) => dayData)
    );
  });

  test("没有 locale 的旧中文合成数据继续按中文绘制", () => {
    const data = buildStatsCardData(weekProgress(), DATE); // 中文日期标签
    const { locale: _locale, ...legacy } = data;
    // 旧夹具的今天标签就是“今天”文字，不含新 locale 字段。
    legacy.days = legacy.days.map((day) =>
      day.isToday ? { ...day, label: "今天" } : day
    );
    const fake = fakeCtx();

    drawStatsCard(fake.ctx, legacy);

    expect(fake.texts.map((item) => item.text)).toContain("法语语法练习");
    expect(fake.texts.map((item) => item.text)).toContain("2026年11月4日");
    expect(fake.texts.map((item) => item.text)).toContain("今天");
  });
});

describe("drawStatsCard 视觉", () => {
  test("使用暖纸白背景、法国蓝/藏青与衬线数字,中文保持系统无衬线", () => {
    const { texts, fillRects, roundRects, gradientStops } = drawWeek();

    expect(gradientStops.map((s) => s.color)).toEqual(["#f6f4ef", "#f2efe8"]);
    expect(
      fillRects.some((r) => r.width === SHARE_CARD_WIDTH && r.height === SHARE_CARD_HEIGHT)
    ).toBe(true);

    const title = textAt(texts, "法语语法练习", 130);
    expect(title.font).toContain("bold 36px");
    expect(title.font).toContain("system-ui");
    expect(title.style).toBe("#1b3578");

    const date = textAt(texts, "2026年11月4日", 170);
    expect(date.font).toContain("normal 30px");
    expect(date.font).toContain("system-ui");
    expect(date.style).toBe("#5f6b7c");

    const todayXp = textAt(texts, "42", 380);
    expect(todayXp.font).toContain("600 220px");
    expect(todayXp.font).toContain("Iowan Old Style");
    expect(todayXp.style).toBe("#1b3578");

    const level = textAt(texts, "5", 710);
    expect(level.font).toContain("600 72px");
    expect(level.font).toContain("Iowan Old Style");
    expect(level.style).toBe("#1c2433");

    const metricLabel = textAt(texts, "连击天数", 760);
    expect(metricLabel.font).toContain("normal 30px");
    expect(metricLabel.font).toContain("system-ui");
    expect(metricLabel.style).toBe("#5f6b7c");

    expect(
      fillRects.some((r) => r.style === "#cbd8f0" && r.height === 2)
    ).toBe(true);
    expect(
      roundRects.some((r) => r.style === "#e3ded3" && r.width > 900 && r.height > 300)
    ).toBe(true);

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

    const oldPalette = [
      "#f0fff0",
      "#e8ffd6",
      "#58cc02",
      "#2f6b00",
      "#ffc800",
      "#6e6e6e",
      "#e5e5e5",
    ];
    for (const color of oldPalette) {
      expect(roundRects.some((r) => r.style === color)).toBe(false);
      expect(fillRects.some((r) => r.style === color)).toBe(false);
      expect(texts.some((t) => t.style === color)).toBe(false);
    }
  });

  test("七日图只有 7 根数据柱:历史蓝、今日金、零值 2px,无灰色柱槽", () => {
    const { texts, roundRects } = drawWeek();

    const bars = roundRects.filter((r) => r.width === 108);
    expect(bars).toHaveLength(7);
    expect(bars.filter((r) => r.style === "#21409a")).toHaveLength(6);
    expect(bars.filter((r) => r.style === "#d9a43a")).toHaveLength(1);

    const chartHeight = Math.max(...bars.map((r) => r.height));
    expect(chartHeight).toBe(260);
    expect(bars.find((r) => r.style === "#d9a43a")?.height).toBe(chartHeight);
    expect(
      bars.some((r) => Math.abs(r.height - (12 / 42) * chartHeight) < 1e-6)
    ).toBe(true);

    const zeroBar = bars.find((r) => r.height === 2);
    expect(zeroBar).toBeDefined();
    expect(zeroBar?.style).toBe("#21409a");
    expect(bars.every((r) => Number.isFinite(r.height))).toBe(true);
    expect(
      roundRects.some((r) => r.style === "#eae5db" && r.width === 108)
    ).toBe(false);
    expect(
      texts.some((t) => t.text === "0" && t.y > CHART_TOP && t.y < CHART_LABEL_Y)
    ).toBe(false);

    const todayLabel = textAt(texts, "今天");
    expect(todayLabel.y).toBe(CHART_LABEL_Y);
    expect(todayLabel.font).toContain("bold 24px");
    expect(todayLabel.font).toContain("system-ui");
    expect(todayLabel.style).toBe("#1c2433");

    const otherLabel = textAt(texts, "10/29");
    expect(otherLabel.y).toBe(CHART_LABEL_Y);
    expect(otherLabel.font).toContain("normal 24px");
    expect(otherLabel.style).toBe("#5f6b7c");

    const valueLabels = texts.filter((t) => t.text === "12");
    expect(valueLabels.some((t) => t.style === "#5f6b7c")).toBe(true);
  });

  test("今日不是最大值时仍用金色突出,最高柱数值保留在白色图表卡内", () => {
    const progress = weekProgress();
    progress.days[shiftDate(DATE, -3)] = day(90);
    const { texts, roundRects } = drawWeek(progress);

    const chartCard = roundRects.find(
      (r) => r.style === "#ffffff" && r.width > 900 && r.height > 300
    );
    expect(chartCard).toBeDefined();

    const bars = roundRects.filter((r) => r.width === 108);
    const goldBar = bars.find((r) => r.style === "#d9a43a");
    const maxBar = bars.reduce((max, bar) => (bar.height > max.height ? bar : max), bars[0]);
    expect(goldBar).toBeDefined();
    expect(goldBar!.height).toBeLessThan(maxBar.height);
    expect(maxBar.style).toBe("#21409a");

    const maxValue = textAt(texts, "90");
    expect(maxValue.y - chartCard!.y).toBeGreaterThan(28);
    expect(maxValue.y).toBeLessThan(chartCard!.y + chartCard!.height);

    const tagline = textAt(texts, "每天练一点法语语法");
    expect(tagline.y - (chartCard!.y + chartCard!.height)).toBeGreaterThan(20);
  });

  test("目标关闭不画填充,未达标蓝色,刚好与超额达标金色", () => {
    const cases = [
      {
        label: "目标关闭",
        progress: weekProgress({ dailyGoal: 0 }),
        fill: null,
        width: null,
        textStyle: "#5f6b7c",
        text: "未设置每日目标",
      },
      {
        label: "未达标",
        progress: weekProgress({ dailyGoal: 100 }),
        fill: "#21409a",
        width: 386.4,
        textStyle: "#5f6b7c",
        text: "目标 100 XP · 已完成 42%",
      },
      {
        label: "刚好达标",
        progress: weekProgress({ dailyGoal: 42 }),
        fill: "#d9a43a",
        width: 920,
        textStyle: "#7a5200",
        text: "目标 42 XP · 已完成 100%",
      },
      {
        label: "超额达标",
        progress: weekProgress({ dailyGoal: 30 }),
        fill: "#d9a43a",
        width: 920,
        textStyle: "#7a5200",
        text: "目标 30 XP · 已完成 100%",
      },
    ];

    for (const item of cases) {
      const { texts, roundRects } = drawWeek(item.progress);
      const fills = roundRects.filter((r) => r.height === 28);
      expect(fills, item.label).toHaveLength(item.fill ? 2 : 1);

      if (item.fill) {
        const goalFill = fills.find((r) => r.style === item.fill);
        expect(goalFill, item.label).toBeDefined();
        expect(Math.abs(goalFill!.width - item.width!), item.label).toBeLessThan(0.01);
      } else {
        expect(
          fills.some((r) => r.style === "#21409a" || r.style === "#d9a43a"),
          item.label
        ).toBe(false);
      }

      const goalText = textAt(texts, item.text);
      expect(goalText.style, item.label).toBe(item.textStyle);
    }
  });

  test("全零周仍画 7 根 2px 柱,不显示 0 值标签", () => {
    const progress = weekProgress({ days: {} });
    const { texts, roundRects } = drawWeek(progress);

    const bars = roundRects.filter((r) => r.width === 108);
    expect(bars).toHaveLength(7);
    expect(bars.every((r) => r.height === 2)).toBe(true);
    expect(bars.filter((r) => r.style === "#21409a")).toHaveLength(6);
    expect(bars.filter((r) => r.style === "#d9a43a")).toHaveLength(1);
    expect(bars.every((r) => Number.isFinite(r.height))).toBe(true);
    expect(texts.map((text) => text.text)).toContain("这一周还没有得分");
    expect(
      texts.some((t) => t.text === "0" && t.y > CHART_TOP && t.y < CHART_LABEL_Y)
    ).toBe(false);
  });

  test("大数字按可用宽度缩放,正常数字保持 220/72", () => {
    const normal = drawWeek();
    expect(fontSizeOf(textAt(normal.texts, "42", 380).font)).toBe(220);
    expect(fontSizeOf(textAt(normal.texts, "420", 710).font)).toBe(72);

    const huge = weekProgress({ xp: 123456789 });
    huge.days[DATE] = day(123456789);
    const { texts } = drawWeek(huge);

    const bigText = textAt(texts, "123456789", 380);
    const bigSize = fontSizeOf(bigText.font);
    expect(bigSize).toBeLessThan(220);
    expect(bigSize).toBeGreaterThan(0);
    expect(testTextWidth(bigText.text, bigText.font)).toBeLessThanOrEqual(880.5);

    const totalXp = textAt(texts, "123456789", 710);
    const totalSize = fontSizeOf(totalXp.font);
    expect(totalSize).toBeLessThan(72);
    expect(totalSize).toBeGreaterThan(0);
    expect(testTextWidth(totalXp.text, totalXp.font)).toBeLessThanOrEqual(280.5);

    // 三指标同字号:极端大值时整行一起缩,避免数字大小参差。
    const streak = textAt(texts, "1", 710);
    const level = textAt(texts, "1234568", 710);
    expect(fontSizeOf(streak.font)).toBe(totalSize);
    expect(fontSizeOf(level.font)).toBe(totalSize);
  });

  test("旧 WebView 没有 roundRect 时三种模式都走 arcTo 路径且仍能绘制", () => {
    const modes = [
      weekProgress(),
      studyWeekProgress(),
      studyWeekProgress({ shareCardContent: "both" }),
    ];

    for (const progress of modes) {
      const data = buildStatsCardData(progress, DATE);
      const { ctx, arcToCalls, roundRects } = fakeCtx({ withRoundRect: false });

      expect(() => drawStatsCard(ctx, data)).not.toThrow();
      expect(arcToCalls()).toBeGreaterThan(0);
      expect(roundRects).toHaveLength(0);
    }
  });
});

describe("drawStatsCard 法语", () => {
  test("xp 模式品牌、日期、目标、指标、图例与页脚全部法语且无中文", () => {
    const { texts } = drawCard(weekProgress(), { locale: "fr" });

    expect(textAt(texts, "Exercices de grammaire française", 130).style).toBe(
      "#1b3578"
    );
    expect(textAt(texts, "4 novembre 2026", 170).style).toBe("#5f6b7c");
    expect(textAt(texts, "XP du jour", 450).style).toBe("#5f6b7c");
    expect(textAt(texts, "Objectif 30 XP · 100 % atteint", 596).style).toBe(
      "#7a5200"
    );
    expect(textAt(texts, "Jours de série", 760).style).toBe("#5f6b7c");
    expect(textAt(texts, "Niveau", 760)).toBeDefined();
    expect(textAt(texts, "XP cumulés", 760)).toBeDefined();
    expect(textAt(texts, "Auj.", 1182).style).toBe("#1c2433");
    expect(
      textAt(texts, "Chaque jour, un peu de grammaire française", 1236).style
    ).toBe("#5f6b7c");

    const allText = texts.map((item) => item.text).join("\n");
    expect(allText).not.toMatch(CJK);
    expect(allText).toContain("française");
    expect(allText).toContain("série");

    expectFits(textAt(texts, "Exercices de grammaire française", 130), 920);
    expectFits(textAt(texts, "4 novembre 2026", 170), 920);
    expectFits(textAt(texts, "Objectif 30 XP · 100 % atteint", 596), 920);
    expectFits(
      textAt(texts, "Chaque jour, un peu de grammaire française", 1236),
      920
    );
  });

  test("xp 模式无目标与空周使用法语提示", () => {
    const noGoal = drawCard(weekProgress({ dailyGoal: 0 }), { locale: "fr" });
    expect(textAt(noGoal.texts, "Aucun objectif quotidien", 596)).toBeDefined();

    const empty = drawCard(weekProgress({ days: {} }), { locale: "fr" });
    expect(empty.texts.map((item) => item.text)).toContain(
      "Pas encore de points cette semaine"
    );
    expect(empty.texts.map((item) => item.text).join("\n")).not.toMatch(CJK);
  });

  test("time 模式今日时长、分项、累计、标题与图例全部法语且不越界", () => {
    const { texts, roundRects } = drawCard(studyWeekProgress(), {
      locale: "fr",
    });

    const hero = textAt(texts, "25 min", 400);
    expect(fontSizeOf(hero.font)).toBeGreaterThanOrEqual(120);
    expect(hero.font).toContain("Iowan Old Style");
    expect(hero.style).toBe("#1b3578");

    expect(textAt(texts, "Temps d’étude aujourd’hui", 468).style).toBe("#5f6b7c");
    expect(textAt(texts, "Cours 10 min · Exercices 15 min", 550).style).toBe(
      "#5f6b7c"
    );
    expect(textAt(texts, "Temps d’étude cumulé 2 h 47 min", 648).style).toBe(
      "#1b3578"
    );
    expect(
      textAt(texts, "Cours 1 h 26 min · Exercices 1 h 21 min", 698).style
    ).toBe("#5f6b7c");

    const title = textAt(texts, "Temps d’étude (7 jours, min)", 784);
    expect(title.style).toBe("#1c2433");
    expect(textAt(texts, "Cours", 784)).toBeDefined();
    expect(textAt(texts, "Exercices", 784)).toBeDefined();
    expect(textAt(texts, "Auj.", 1092)).toBeDefined();

    const allText = texts.map((item) => item.text).join("\n");
    expect(allText).not.toMatch(CJK);
    expect(allText).not.toContain("XP");
    expect(allText).not.toContain("Objectif");
    expect(allText).not.toContain("Niveau");

    // 标题与右侧图例同一基线，但按实际字宽留出间距，不互相覆盖。
    const titleBounds = boundsOf(title);
    const readLabelBounds = boundsOf(textAt(texts, "Cours", 784));
    expect(titleBounds.right + 24).toBeLessThanOrEqual(readLabelBounds.left);
    expect(titleBounds.left).toBeGreaterThanOrEqual(120);
    expect(titleBounds.right).toBeLessThanOrEqual(980);

    expectFits(hero, 920);
    expectFits(textAt(texts, "Cours 10 min · Exercices 15 min", 550), 920);
    expectFits(textAt(texts, "Temps d’étude cumulé 2 h 47 min", 648), 920);
    expectFits(
      textAt(texts, "Cours 1 h 26 min · Exercices 1 h 21 min", 698),
      920
    );
    expectFits(title, 860);

    const valueLabels = texts.filter(
      (item) => item.y > TIME_CHART_TOP - 12 && item.y <= TIME_CHART_BOTTOM
    );
    expect(valueLabels.length).toBeGreaterThan(0);
    for (const label of valueLabels) {
      expectFits(label, 100);
    }

    const panel = roundRects.find(
      (rect) => rect.style === "#ffffff" && rect.width > 900 && rect.height > 350
    );
    expect(panel).toBeDefined();
  });

  test("time 模式空周使用法语学习记录提示", () => {
    const { texts } = drawCard(
      progressWith({ xp: 99999, shareCardContent: "time", days: { [DATE]: day(500) } }),
      { locale: "fr" }
    );

    expect(textAt(texts, "0 min", 400)).toBeDefined();
    expect(textAt(texts, "Temps d’étude cumulé 0 min", 648)).toBeDefined();
    expect(texts.map((item) => item.text)).toContain(
      "Pas encore de temps d’étude cette semaine"
    );
    expect(texts.map((item) => item.text).join("\n")).not.toMatch(CJK);
  });

  test("both 模式两套主视觉、目标与两张图标题全部法语", () => {
    const { texts, roundRects } = drawCard(
      studyWeekProgress({ shareCardContent: "both" }),
      { locale: "fr" }
    );

    expect(textAt(texts, "42", 392).x).toBe(300);
    expect(textAt(texts, "25 min", 392).x).toBe(780);
    expect(textAt(texts, "XP du jour", 452)).toBeDefined();
    expect(textAt(texts, "Temps d’étude aujourd’hui", 452)).toBeDefined();
    expect(textAt(texts, "Objectif 60 XP · 70 % atteint", 578).style).toBe(
      "#5f6b7c"
    );
    expect(textAt(texts, "XP des 7 derniers jours", 668).style).toBe("#1c2433");
    expect(textAt(texts, "Temps d’étude (7 jours, min)", 936).style).toBe(
      "#1c2433"
    );
    expect(textAt(texts, "Cours", 936)).toBeDefined();
    expect(textAt(texts, "Exercices", 936)).toBeDefined();
    expect(textAt(texts, "Auj.", 1128)).toBeDefined();

    const allText = texts.map((item) => item.text).join("\n");
    expect(allText).not.toMatch(CJK);

    const panels = roundRects.filter(
      (rect) => rect.style === "#ffffff" && rect.width > 900
    );
    expect(panels).toHaveLength(2);

    for (const label of texts.filter(
      (item) => item.y > BOTH_XP_CHART_TOP - 12 && item.y <= BOTH_XP_CHART_BOTTOM
    )) {
      expectFits(label, 100);
    }
    for (const label of texts.filter(
      (item) =>
        item.y > BOTH_STUDY_CHART_TOP - 12 && item.y <= BOTH_STUDY_CHART_BOTTOM
    )) {
      expectFits(label, 100);
    }
  });

  test("both 模式全零使用法语空状态", () => {
    const { texts } = drawCard(progressWith({ days: {} }), { locale: "fr" });

    expect(textAt(texts, "0", 392)).toBeDefined();
    expect(textAt(texts, "0 min", 392)).toBeDefined();
    expect(textAt(texts, "Objectif 30 XP · 0 % atteint", 578)).toBeDefined();
    expect(texts.map((item) => item.text)).toContain(
      "Pas encore de points cette semaine"
    );
    expect(texts.map((item) => item.text)).toContain(
      "Pas encore de temps d’étude cette semaine"
    );
    expect(texts.map((item) => item.text).join("\n")).not.toMatch(CJK);
  });

  test("法语超长时长与数值按测量收缩，标签仍在卡片内", () => {
    const progress = studyWeekProgress({
      days: {
        ...studyWeekProgress().days,
        [DATE]: studyDay(42, 123456789, 987654321),
      },
    });
    const { texts } = drawCard(progress, { locale: "fr" });

    const hero = texts.find(
      (item) => item.y === 400 && normalizeSpaces(item.text).includes("h 59 min")
    );
    expect(hero).toBeDefined();
    expectFits(hero!, 920);

    const total = texts.find(
      (item) => item.y === 648 && normalizeSpaces(item.text).includes("cumulé")
    );
    expect(total).toBeDefined();
    expectFits(total!, 920);

    const valueLabels = texts.filter(
      (item) => item.y > TIME_CHART_TOP - 12 && item.y <= TIME_CHART_BOTTOM
    );
    expect(valueLabels.length).toBeGreaterThan(0);
    for (const label of valueLabels) {
      expectFits(label, 100);
    }
  });
});

describe("drawStatsCard 时间模式", () => {
  test("今日学习时长为主视觉,展示今日分项、累计与近七天时间,不出现 XP 目标或等级", () => {
    const { texts, roundRects } = drawCard(studyWeekProgress());

    const hero = textAt(texts, "25 分", 400);
    expect(fontSizeOf(hero.font)).toBeGreaterThanOrEqual(120);
    expect(hero.font).toContain("Iowan Old Style");
    expect(hero.style).toBe("#1b3578");

    expect(textAt(texts, "今日学习时长", 468).style).toBe("#5f6b7c");
    expect(textAt(texts, "看讲解 10 分 · 做练习 15 分", 550).style).toBe("#5f6b7c");
    expect(textAt(texts, "累计学习 2 小时 47 分", 648).style).toBe("#1b3578");
    expect(
      textAt(texts, "看讲解 1 小时 26 分 · 做练习 1 小时 21 分", 698).style
    ).toBe("#5f6b7c");

    const title = textAt(texts, "最近 7 天学习时长（分钟）");
    expect(title.style).toBe("#1c2433");
    expect(textAt(texts, "看讲解").y).toBe(784);
    expect(textAt(texts, "做练习").y).toBe(784);
    expect(texts.some((text) => text.text === "今日 XP")).toBe(false);

    const allText = texts.map((text) => text.text).join("\n");
    expect(allText).not.toContain("今日 XP");
    expect(allText).not.toContain("目标");
    expect(allText).not.toContain("等级");
    expect(allText).not.toContain("累计 XP");

    const panel = roundRects.find(
      (rect) => rect.style === "#ffffff" && rect.width > 900 && rect.height > 350
    );
    expect(panel).toBeDefined();

    const bars = roundRects.filter((rect) => rect.width === 108);
    expect(bars).toHaveLength(7 + 2); // 今天与 10/31 同时有阅读/练习两段
    const byX = new Map<number, typeof bars>();
    for (const bar of bars) {
      byX.set(bar.x, [...(byX.get(bar.x) ?? []), bar]);
    }
    expect(byX.size).toBe(7);
    const stackHeights = Array.from(byX.values()).map((segments) =>
      segments.reduce((sum, segment) => sum + segment.height, 0)
    );
    expect(Math.max(...stackHeights)).toBeCloseTo(220, 5);

    const todayBars = byX.get(882) ?? [];
    expect(todayBars).toHaveLength(2);
    expect(todayBars.find((bar) => bar.style === "#d9a43a")?.height).toBeCloseTo(
      (600 / 3600) * 220,
      5
    );
    expect(todayBars.find((bar) => bar.style === "#21409a")?.height).toBeCloseTo(
      (900 / 3600) * 220,
      5
    );
    expect(todayBars.reduce((sum, bar) => sum + bar.height, 0)).toBeCloseTo(
      (1500 / 3600) * 220,
      5
    );

    const zeroDay = byX.get(90 + 2 * 132) ?? [];
    expect(zeroDay).toHaveLength(1);
    expect(zeroDay[0].height).toBe(2);
    expect(zeroDay[0].style).toBe("#cbd8f0");

    // 近七天分钟数标签:今天 25 分。
    expect(
      texts.some(
        (text) =>
          text.text === "25" && text.y > TIME_CHART_TOP && text.y < TIME_CHART_BOTTOM
      )
    ).toBe(true);
  });

  test("全零时间不按 XP 推算,仍画 7 根基线柱", () => {
    const progress = progressWith({
      xp: 99999,
      shareCardContent: "time",
      days: { [DATE]: day(500) },
    });
    const { texts, roundRects } = drawCard(progress);

    expect(textAt(texts, "0 分", 400)).toBeDefined();
    expect(textAt(texts, "累计学习 0 分", 648)).toBeDefined();
    expect(texts.map((text) => text.text)).toContain("这一周还没有学习记录");
    expect(texts.some((text) => text.text === "今日 XP")).toBe(false);

    const bars = roundRects.filter((rect) => rect.width === 108);
    expect(bars).toHaveLength(7);
    expect(bars.every((bar) => bar.height === 2)).toBe(true);
    expect(bars.every((bar) => bar.style === "#cbd8f0")).toBe(true);
  });

  test("时间模式大值按可用宽度缩放,标签仍留在图表卡内", () => {
    const progress = studyWeekProgress({
      days: {
        ...studyWeekProgress().days,
        [DATE]: studyDay(42, 123456789, 987654321),
      },
    });
    const { texts, roundRects } = drawCard(progress);

    const hero = textAt(texts, "308641 小时 59 分", 400);
    expect(testTextWidth(hero.text, hero.font)).toBeLessThanOrEqual(920.5);

    const valueLabels = texts.filter(
      (text) => text.y > TIME_CHART_TOP - 12 && text.y <= TIME_CHART_BOTTOM
    );
    expect(valueLabels.length).toBeGreaterThan(0);
    for (const label of valueLabels) {
      expect(testTextWidth(label.text, label.font)).toBeLessThanOrEqual(100.5);
    }

    const bars = roundRects.filter((rect) => rect.width === 108);
    const card = roundRects.find(
      (rect) => rect.style === "#ffffff" && rect.width > 900 && rect.height > 350
    );
    expect(card).toBeDefined();
    for (const bar of bars) {
      expect(bar.y).toBeGreaterThanOrEqual(card!.y);
      expect(bar.y + bar.height).toBeLessThanOrEqual(card!.y + card!.height);
    }
  });
});

describe("drawStatsCard 都有模式", () => {
  test("同时展示今日 XP 与学习时长,两张七日图各自独立刻度", () => {
    const { texts, roundRects } = drawCard(
      studyWeekProgress({ shareCardContent: "both" })
    );

    const xpHero = textAt(texts, "42", 392);
    expect(xpHero.font).toContain("600 180px");
    expect(xpHero.font).toContain("Iowan Old Style");
    expect(xpHero.x).toBe(300);
    expect(textAt(texts, "今日 XP", 452).style).toBe("#5f6b7c");

    const timeHero = textAt(texts, "25 分", 392);
    expect(timeHero.font).toContain("600");
    expect(timeHero.x).toBe(780);
    expect(textAt(texts, "今日学习时长", 452).style).toBe("#5f6b7c");

    expect(textAt(texts, "目标 60 XP · 已完成 70%", 578).style).toBe("#5f6b7c");
    expect(textAt(texts, "最近 7 天 XP", 668).style).toBe("#1c2433");
    expect(textAt(texts, "最近 7 天学习时长（分钟）", 936).style).toBe("#1c2433");
    expect(textAt(texts, "看讲解").y).toBe(936);

    const panels = roundRects.filter(
      (rect) => rect.style === "#ffffff" && rect.width > 900
    );
    expect(panels).toHaveLength(2);

    const xpBars = roundRects.filter(
      (rect) =>
        rect.width === 108 &&
        rect.y >= BOTH_XP_CHART_TOP - 2 &&
        rect.y + rect.height <= BOTH_XP_CHART_BOTTOM + 2
    );
    expect(xpBars).toHaveLength(7);
    expect(Math.max(...xpBars.map((bar) => bar.height))).toBeCloseTo(108, 5);
    expect(xpBars.find((bar) => bar.style === "#d9a43a")?.height).toBeCloseTo(
      (42 / 90) * 108,
      5
    );

    const studyBars = roundRects.filter(
      (rect) =>
        rect.width === 108 &&
        rect.y >= BOTH_STUDY_CHART_TOP - 2 &&
        rect.y + rect.height <= BOTH_STUDY_CHART_BOTTOM + 2
    );
    const byX = new Map<number, typeof studyBars>();
    for (const bar of studyBars) {
      byX.set(bar.x, [...(byX.get(bar.x) ?? []), bar]);
    }
    expect(byX.size).toBe(7);
    expect(
      Math.max(
        ...Array.from(byX.values()).map((segments) =>
          segments.reduce((sum, segment) => sum + segment.height, 0)
        )
      )
    ).toBeCloseTo(114, 5);

    const todayStudy = byX.get(882) ?? [];
    expect(todayStudy).toHaveLength(2);
    expect(todayStudy.reduce((sum, bar) => sum + bar.height, 0)).toBeCloseTo(
      (1500 / 3600) * 114,
      5
    );

    // 两张图的最大柱高不同(108 vs 114),证明没有共用 XP/时间混合刻度。
    expect(Math.max(...xpBars.map((bar) => bar.height))).not.toBeCloseTo(
      Math.max(
        ...Array.from(byX.values()).map((segments) =>
          segments.reduce((sum, segment) => sum + segment.height, 0)
        )
      ),
      5
    );
  });

  test("全部为零时仍绘制两张图和零值基线", () => {
    const { texts, roundRects } = drawCard(progressWith({ days: {} }));

    expect(textAt(texts, "0", 392)).toBeDefined();
    expect(textAt(texts, "0 分", 392)).toBeDefined();
    expect(textAt(texts, "最近 7 天 XP", 668)).toBeDefined();
    expect(textAt(texts, "最近 7 天学习时长（分钟）", 936)).toBeDefined();
    expect(texts.map((text) => text.text)).toContain("这一周还没有得分");
    expect(texts.map((text) => text.text)).toContain("这一周还没有学习记录");

    const xpBars = roundRects.filter(
      (rect) =>
        rect.width === 108 &&
        rect.y >= BOTH_XP_CHART_TOP - 2 &&
        rect.y + rect.height <= BOTH_XP_CHART_BOTTOM + 2
    );
    expect(xpBars).toHaveLength(7);
    expect(xpBars.every((bar) => bar.height === 2)).toBe(true);

    const studyBars = roundRects.filter(
      (rect) =>
        rect.width === 108 &&
        rect.y >= BOTH_STUDY_CHART_TOP - 2 &&
        rect.y + rect.height <= BOTH_STUDY_CHART_BOTTOM + 2
    );
    expect(studyBars).toHaveLength(7);
    expect(studyBars.every((bar) => bar.height === 2)).toBe(true);
  });

  test("都有模式大值收缩到各自列宽,不重叠", () => {
    const progress = weekProgress({
      xp: 123456789,
      shareCardContent: "both",
      days: { [DATE]: studyDay(123456789, 987654321, 123456789) },
    });
    const { texts } = drawCard(progress);

    const xpHero = textAt(texts, "123456789", 392);
    expect(testTextWidth(xpHero.text, xpHero.font)).toBeLessThanOrEqual(380.5);

    const timeHero = textAt(texts, "308641 小时 59 分", 392);
    expect(testTextWidth(timeHero.text, timeHero.font)).toBeLessThanOrEqual(400.5);

    const xpLabels = texts.filter(
      (text) => text.y > BOTH_XP_CHART_TOP - 12 && text.y <= BOTH_XP_CHART_BOTTOM
    );
    expect(xpLabels.length).toBeGreaterThan(0);
    for (const label of xpLabels) {
      expect(testTextWidth(label.text, label.font)).toBeLessThanOrEqual(100.5);
    }

    const studyLabels = texts.filter(
      (text) => text.y > BOTH_STUDY_CHART_TOP - 12 && text.y <= BOTH_STUDY_CHART_BOTTOM
    );
    expect(
      studyLabels.some((label) => label.text === "18518519")
    ).toBe(true);
    for (const label of studyLabels) {
      expect(testTextWidth(label.text, label.font)).toBeLessThanOrEqual(100.5);
    }
  });

  test("经验模式保留单一 XP 图,不出现学习时长内容", () => {
    const { texts, roundRects } = drawWeek();

    expect(texts.some((text) => text.text.includes("学习时长"))).toBe(false);
    expect(roundRects.filter((rect) => rect.style === "#ffffff")).toHaveLength(1);
  });
});

describe("sharing 文案域", () => {
  test("中法键与占位符一致，法语非空且无中文", () => {
    expect(Object.keys(sharingFr).sort()).toEqual(Object.keys(sharingZhCN).sort());

    const placeholders = (text: string) =>
      [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)]
        .map((match) => match[1] as string)
        .sort();

    for (const key of Object.keys(sharingZhCN) as (keyof typeof sharingZhCN)[]) {
      expect(sharingZhCN[key].trim(), key).not.toBe("");
      expect(sharingFr[key].trim(), key).not.toBe("");
      expect(sharingFr[key], key).not.toMatch(CJK);
      expect(placeholders(sharingFr[key]), key).toEqual(
        placeholders(sharingZhCN[key])
      );
    }
  });
});

describe("statsCardFilename", () => {
  test("按日期生成固定 PNG 文件名，法语带语言标记", () => {
    expect(statsCardFilename("2026-11-04")).toBe("fge-stats-2026-11-04.png");
    expect(statsCardFilename("2026-11-04", "fr")).toBe(
      "fge-stats-fr-2026-11-04.png"
    );
  });
});

describe("createStatsCardCanvas", () => {
  test("画布角色与无障碍名称随当前语言", () => {
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(fakeCtx().ctx);

    try {
      const frCanvas = createStatsCardCanvas(
        buildStatsCardData(weekProgress(), DATE, "fr")
      );
      expect(frCanvas.getAttribute("role")).toBe("img");
      expect(frCanvas.getAttribute("aria-label")).toBe(
        "Partager l’image du bilan du jour"
      );

      const zhCanvas = createStatsCardCanvas(
        buildStatsCardData(weekProgress(), DATE)
      );
      expect(zhCanvas.getAttribute("aria-label")).toBe("分享今日打卡图片");
    } finally {
      spy.mockRestore();
    }
  });

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
