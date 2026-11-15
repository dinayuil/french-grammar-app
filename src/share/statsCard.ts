import { levelFor, streakFor, studyTotals } from "../engine";
import { formatStudyDuration } from "../formatStudyDuration";
import { shiftDate } from "../storage";
import type { DayRecord, Progress, ShareCardContent } from "../types";

export const SHARE_CARD_WIDTH = 1080;
export const SHARE_CARD_HEIGHT = 1350;

export interface StatsCardDay {
  date: string;
  label: string;
  xp: number;
  isToday: boolean;
  readSeconds: number;
  practiceSeconds: number;
  studySeconds: number;
}

export interface StatsCardData {
  date: string;
  dateLabel: string;
  mode: ShareCardContent;
  todayXp: number;
  goal: number;
  goalPercent: number;
  streak: number;
  level: number;
  totalXp: number;
  todayRead: number;
  todayPractice: number;
  todayStudy: number;
  studyRead: number;
  studyPractice: number;
  studyTotal: number;
  days: StatsCardDay[];
  maxXp: number;
  maxStudy: number;
}

const FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
const DISPLAY_STACK =
  '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';

// 固定品牌浅色 palette:对齐当前浅色主题 token,分享卡不跟随应用主题。
const COLOR_BG_TOP = "#f6f4ef"; // --bg
const COLOR_BG_BOTTOM = "#f2efe8"; // --surface-muted
const COLOR_INK = "#1b3578"; // --primary-ink
const COLOR_TEXT = "#1c2433"; // --text
const COLOR_SECONDARY = "#5f6b7c"; // --text-secondary
const COLOR_PRIMARY = "#21409a"; // --primary
const COLOR_GOLD = "#d9a43a"; // --gold
const COLOR_GOLD_INK = "#7a5200"; // --gold-ink
const COLOR_TRACK = "#eae5db"; // --surface-sunken
const COLOR_SURFACE = "#ffffff"; // --surface
const COLOR_BORDER = "#e3ded3"; // --border
const COLOR_RULE = "#cbd8f0"; // --primary-border

const MARGIN_X = 80;
const CONTENT_WIDTH = SHARE_CARD_WIDTH - MARGIN_X * 2;
const CENTER_X = SHARE_CARD_WIDTH / 2;

// 经验卡(上一版布局)的七日图。
const CHART_TOP = 880;
const CHART_BAR_HEIGHT = 260; // 含数值/日期标签的整块高度约 320
const BAR_WIDTH = 108;
const BAR_GAP = 24;
const BAR_COUNT = 7;
const CHART_WIDTH = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP;
const CHART_LEFT = MARGIN_X + (CONTENT_WIDTH - CHART_WIDTH) / 2;
const CHART_PANEL_X = 60;
const CHART_PANEL_TOP = 840;
const CHART_PANEL_WIDTH = SHARE_CARD_WIDTH - CHART_PANEL_X * 2;
const CHART_PANEL_HEIGHT = 360;
const CHART_PANEL_RADIUS = 28;
const CHART_PANEL_BORDER = 2;

// 时间卡:今日时长主视觉 + 分项/累计 + 七日堆叠图。
const TIME_PANEL_TOP = 738;
const TIME_PANEL_HEIGHT = 392;
const TIME_PANEL_TITLE_Y = 784;
const TIME_CHART_TOP = 828;
const TIME_CHART_BAR_HEIGHT = 220;
const TIME_CHART_LABEL_Y = 1092;

// 都有卡:左右双主视觉 + 两张独立刻度的小图。
const BOTH_HERO_BASELINE = 392;
const BOTH_HERO_LABELS_Y = 452;
const BOTH_XP_X = 300;
const BOTH_TIME_X = 780;
const BOTH_XP_MAX_WIDTH = 380;
const BOTH_TIME_MAX_WIDTH = 400;
const BOTH_PANEL_TOP = 628;
const BOTH_XP_PANEL_HEIGHT = 254;
const BOTH_XP_TITLE_Y = 668;
const BOTH_XP_CHART_TOP = 706;
const BOTH_XP_CHART_BAR_HEIGHT = 108;
const BOTH_XP_LABEL_Y = 856;
const BOTH_STUDY_PANEL_TOP = 896;
const BOTH_STUDY_PANEL_HEIGHT = 264;
const BOTH_STUDY_TITLE_Y = 936;
const BOTH_STUDY_CHART_TOP = 972;
const BOTH_STUDY_CHART_BAR_HEIGHT = 114;
const BOTH_STUDY_LABEL_Y = 1128;

const BIG_XP_MAX_WIDTH = 880;
const METRIC_MAX_WIDTH = 280;
const BAR_VALUE_MAX_WIDTH = BAR_WIDTH - 8;

type FontWeight = "normal" | "600" | "bold";

const font = (size: number, weight: FontWeight = "normal", family = FONT_STACK) =>
  `${weight} ${size}px ${family}`;

const displayFont = (size: number, weight: FontWeight = "600") =>
  font(size, weight, DISPLAY_STACK);

/**
 * 数字按可用宽度等比收缩;正常值保持设计字号。
 * 只用于数字/整行文字,中文标签仍走固定字号。
 */
function fittedFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  baseSize: number,
  maxWidth: number,
  weight: FontWeight,
  family: string
): number {
  ctx.font = font(baseSize, weight, family);
  const width = ctx.measureText(text).width;
  if (!Number.isFinite(width) || width <= 0 || width <= maxWidth) return baseSize;
  return Math.max(1, Math.floor((baseSize * maxWidth) / width));
}

function formatDateLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

function shortDateLabel(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${month}/${day}`;
}

function isValidShareContent(value: unknown): value is ShareCardContent {
  return value === "xp" || value === "time" || value === "both";
}

/** 旧运行时对象可能没有 shareCardContent;缺省或非法值回退 both。 */
function shareCardContentFor(progress: Progress): ShareCardContent {
  const value = (progress as { shareCardContent?: unknown }).shareCardContent;
  return isValidShareContent(value) ? value : "both";
}

function studySeconds(
  record: DayRecord | null | undefined,
  field: "readSeconds" | "practiceSeconds"
): number {
  if (!record || typeof record !== "object") return 0;
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

function finiteSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** 纯数据:最近 7 天(含 date)、阅读/做题秒数、今日 XP、目标、连击、等级与累计。 */
export function buildStatsCardData(progress: Progress, date: string): StatsCardData {
  const days: StatsCardDay[] = [];
  for (let offset = -6; offset <= 0; offset += 1) {
    const dayDate = shiftDate(date, offset);
    const record = progress.days[dayDate];
    const readSeconds = studySeconds(record, "readSeconds");
    const practiceSeconds = studySeconds(record, "practiceSeconds");
    days.push({
      date: dayDate,
      label: offset === 0 ? "今天" : shortDateLabel(dayDate),
      xp: record?.xp ?? 0,
      isToday: offset === 0,
      readSeconds,
      practiceSeconds,
      studySeconds: readSeconds + practiceSeconds,
    });
  }

  const todayXp = progress.days[date]?.xp ?? 0;
  const todayRead = studySeconds(progress.days[date], "readSeconds");
  const todayPractice = studySeconds(progress.days[date], "practiceSeconds");
  const totals = studyTotals(progress.days);
  const studyRead = finiteSeconds(totals.read);
  const studyPractice = finiteSeconds(totals.practice);
  const goal = progress.dailyGoal;

  return {
    date,
    dateLabel: formatDateLabel(date),
    mode: shareCardContentFor(progress),
    todayXp,
    goal,
    goalPercent: goal > 0 ? Math.min(100, Math.round((todayXp / goal) * 100)) : 0,
    streak: streakFor(progress.days, goal, date),
    level: levelFor(progress.xp),
    totalXp: progress.xp,
    todayRead,
    todayPractice,
    todayStudy: todayRead + todayPractice,
    studyRead,
    studyPractice,
    studyTotal: studyRead + studyPractice,
    days,
    maxXp: Math.max(1, ...days.map((d) => d.xp)),
    maxStudy: Math.max(1, ...days.map((d) => d.studySeconds)),
  };
}

/** 圆角矩形优先用 roundRect;旧 WebView 缺失时退化为 arcTo 路径。 */
function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
  } else {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }
  ctx.fill();
}

function drawCardBackground(ctx: CanvasRenderingContext2D): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, SHARE_CARD_HEIGHT);
  gradient.addColorStop(0, COLOR_BG_TOP);
  gradient.addColorStop(1, COLOR_BG_BOTTOM);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);
}

function drawCardHeader(ctx: CanvasRenderingContext2D, data: StatsCardData): void {
  ctx.fillStyle = COLOR_RULE;
  ctx.fillRect(MARGIN_X, 205, CONTENT_WIDTH, 2);

  ctx.textAlign = "left";
  ctx.fillStyle = COLOR_INK;
  ctx.font = font(36, "bold");
  ctx.fillText("法语语法练习", MARGIN_X, 130);

  ctx.fillStyle = COLOR_SECONDARY;
  ctx.font = font(30);
  ctx.fillText(data.dateLabel, MARGIN_X, 170);
}

function drawCardFooter(ctx: CanvasRenderingContext2D): void {
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR_SECONDARY;
  ctx.font = font(30);
  ctx.fillText("每天练一点法语语法", CENTER_X, 1236);

  ctx.fillStyle = COLOR_INK;
  ctx.font = font(24);
  ctx.fillText("法语语法练习", CENTER_X, 1266);
}

/** 白卡:先画 2px 纸边,再画纸面。 */
function drawChartPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.fillStyle = COLOR_BORDER;
  fillRoundRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = COLOR_SURFACE;
  fillRoundRect(
    ctx,
    x + CHART_PANEL_BORDER,
    y + CHART_PANEL_BORDER,
    width - CHART_PANEL_BORDER * 2,
    height - CHART_PANEL_BORDER * 2,
    radius - CHART_PANEL_BORDER
  );
}

function drawGoalBar(
  ctx: CanvasRenderingContext2D,
  data: StatsCardData,
  barY: number,
  barHeight: number,
  textY: number,
  textSize: number
): void {
  const goalMet = data.goal > 0 && data.goalPercent >= 100;
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR_TRACK;
  fillRoundRect(ctx, MARGIN_X, barY, CONTENT_WIDTH, barHeight, barHeight / 2);

  if (data.goalPercent > 0) {
    ctx.fillStyle = goalMet ? COLOR_GOLD : COLOR_PRIMARY;
    fillRoundRect(
      ctx,
      MARGIN_X,
      barY,
      (CONTENT_WIDTH * data.goalPercent) / 100,
      barHeight,
      barHeight / 2
    );
  }

  ctx.fillStyle = goalMet ? COLOR_GOLD_INK : COLOR_SECONDARY;
  ctx.font = font(textSize);
  ctx.fillText(
    data.goal > 0
      ? `目标 ${data.goal} XP · 已完成 ${data.goalPercent}%`
      : "未设置每日目标",
    CENTER_X,
    textY
  );
}

function drawXpBars(
  ctx: CanvasRenderingContext2D,
  data: StatsCardData,
  options: {
    chartTop: number;
    barHeight: number;
    valueSize: number;
    labelY: number;
    labelSize: number;
  }
): void {
  const { chartTop, barHeight, valueSize, labelY, labelSize } = options;
  const chartBottom = chartTop + barHeight;

  data.days.forEach((day, index) => {
    const x = CHART_LEFT + index * (BAR_WIDTH + BAR_GAP);

    const height = Math.max(
      2,
      Math.min(barHeight, (day.xp / data.maxXp) * barHeight)
    );
    const y = chartBottom - height;
    ctx.fillStyle = day.isToday ? COLOR_GOLD : COLOR_PRIMARY;
    fillRoundRect(ctx, x, y, BAR_WIDTH, height, 8);

    if (day.xp > 0) {
      const valueText = String(day.xp);
      const fitted = fittedFontSize(
        ctx,
        valueText,
        valueSize,
        BAR_VALUE_MAX_WIDTH,
        "normal",
        FONT_STACK
      );
      ctx.fillStyle = COLOR_SECONDARY;
      ctx.font = font(fitted);
      ctx.textAlign = "center";
      ctx.fillText(valueText, x + BAR_WIDTH / 2, y - 8);
    }

    ctx.fillStyle = day.isToday ? COLOR_TEXT : COLOR_SECONDARY;
    ctx.font = font(labelSize, day.isToday ? "bold" : "normal");
    ctx.textAlign = "center";
    ctx.fillText(day.label, x + BAR_WIDTH / 2, labelY);
  });
}

function drawStudyBars(
  ctx: CanvasRenderingContext2D,
  data: StatsCardData,
  options: {
    chartTop: number;
    barHeight: number;
    valueSize: number;
    labelY: number;
    labelSize: number;
  }
): void {
  const { chartTop, barHeight, valueSize, labelY, labelSize } = options;
  const chartBottom = chartTop + barHeight;

  data.days.forEach((day, index) => {
    const x = CHART_LEFT + index * (BAR_WIDTH + BAR_GAP);
    const total = day.studySeconds;

    if (total <= 0) {
      // 空白天画一条浅蓝基线,与白色图卡区分,不伪造练习/阅读段。
      ctx.fillStyle = COLOR_RULE;
      fillRoundRect(ctx, x, chartBottom - 2, BAR_WIDTH, 2, 1);
    } else {
      const height = Math.max(2, Math.min(barHeight, (total / data.maxStudy) * barHeight));
      const practiceHeight = (height * day.practiceSeconds) / total;
      const readHeight = height - practiceHeight;
      const y = chartBottom - height;

      if (practiceHeight > 0) {
        ctx.fillStyle = COLOR_PRIMARY;
        fillRoundRect(
          ctx,
          x,
          chartBottom - practiceHeight,
          BAR_WIDTH,
          practiceHeight,
          Math.min(8, practiceHeight / 2)
        );
      }
      if (readHeight > 0) {
        ctx.fillStyle = COLOR_GOLD;
        fillRoundRect(ctx, x, y, BAR_WIDTH, readHeight, Math.min(8, readHeight / 2));
      }

      const minutes = Math.round(total / 60);
      if (minutes > 0) {
        const valueText = String(minutes);
        const fitted = fittedFontSize(
          ctx,
          valueText,
          valueSize,
          BAR_VALUE_MAX_WIDTH,
          "normal",
          FONT_STACK
        );
        ctx.fillStyle = COLOR_SECONDARY;
        ctx.font = font(fitted);
        ctx.textAlign = "center";
        ctx.fillText(valueText, x + BAR_WIDTH / 2, y - 8);
      }
    }

    ctx.fillStyle = day.isToday ? COLOR_TEXT : COLOR_SECONDARY;
    ctx.font = font(labelSize, day.isToday ? "bold" : "normal");
    ctx.textAlign = "center";
    ctx.fillText(day.label, x + BAR_WIDTH / 2, labelY);
  });
}

function drawStudyLegend(
  ctx: CanvasRenderingContext2D,
  rightEdge: number,
  baseline: number
): void {
  const labelSize = 24;
  const dotSize = 16;
  const dotGap = 8;
  const itemGap = 24;
  ctx.font = font(labelSize);
  const readWidth = ctx.measureText("看讲解").width;
  const practiceWidth = ctx.measureText("做练习").width;

  const practiceLabelX = rightEdge - practiceWidth;
  const practiceDotX = practiceLabelX - dotGap - dotSize;
  const readLabelX = practiceDotX - itemGap - readWidth;
  const readDotX = readLabelX - dotGap - dotSize;

  ctx.fillStyle = COLOR_GOLD;
  fillRoundRect(ctx, readDotX, baseline - 16, dotSize, dotSize, 3);
  ctx.fillStyle = COLOR_SECONDARY;
  ctx.font = font(labelSize);
  ctx.textAlign = "left";
  ctx.fillText("看讲解", readLabelX, baseline);

  ctx.fillStyle = COLOR_PRIMARY;
  fillRoundRect(ctx, practiceDotX, baseline - 16, dotSize, dotSize, 3);
  ctx.fillStyle = COLOR_SECONDARY;
  ctx.font = font(labelSize);
  ctx.textAlign = "left";
  ctx.fillText("做练习", practiceLabelX, baseline);
}

/** 整周无数据时的安静提示:避免白色图表卡看起来像渲染失败。 */
function drawChartEmptyNote(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number
): void {
  ctx.fillStyle = COLOR_SECONDARY;
  ctx.font = font(28);
  ctx.textAlign = "center";
  ctx.fillText(text, CENTER_X, y);
}

/** 固定字号整行:长文本(大时长)按内容宽度收缩,中文仍走系统无衬线。 */
function drawFittedLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  baseSize: number,
  weight: FontWeight,
  color: string
): void {
  const size = fittedFontSize(ctx, text, baseSize, maxWidth, weight, FONT_STACK);
  ctx.fillStyle = color;
  ctx.font = font(size, weight);
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
}

/** 经验卡:保留上一版版式,只增加整行缩放与模式分支。 */
function drawXpStatsCard(ctx: CanvasRenderingContext2D, data: StatsCardData): void {
  drawCardBackground(ctx);
  drawCardHeader(ctx, data);

  // 今日 XP 主视觉
  ctx.textAlign = "center";
  const todayXpText = String(data.todayXp);
  const todayXpSize = fittedFontSize(
    ctx,
    todayXpText,
    220,
    BIG_XP_MAX_WIDTH,
    "600",
    DISPLAY_STACK
  );
  ctx.fillStyle = COLOR_INK;
  ctx.font = displayFont(todayXpSize);
  ctx.fillText(todayXpText, CENTER_X, 380);

  ctx.fillStyle = COLOR_SECONDARY;
  ctx.font = font(44);
  ctx.fillText("今日 XP", CENTER_X, 450);

  drawGoalBar(ctx, data, 520, 28, 596, 32);

  // 三指标行
  const metrics = [
    { value: data.streak, label: "连击天数" },
    { value: data.level, label: "等级" },
    { value: data.totalXp, label: "累计 XP" },
  ];
  const columnX = [
    MARGIN_X + CONTENT_WIDTH / 6,
    CENTER_X,
    MARGIN_X + (CONTENT_WIDTH * 5) / 6,
  ];
  const metricValues = metrics.map((metric) => String(metric.value));
  // 三指标共用一个字号:极端大值时整行一起缩,避免同一行出现三种数字大小。
  const metricSize = Math.min(
    72,
    ...metricValues.map((value) =>
      fittedFontSize(ctx, value, 72, METRIC_MAX_WIDTH, "600", DISPLAY_STACK)
    )
  );
  metrics.forEach((metric, index) => {
    ctx.fillStyle = COLOR_TEXT;
    ctx.font = displayFont(metricSize);
    ctx.textAlign = "center";
    ctx.fillText(String(metric.value), columnX[index], 710);

    ctx.fillStyle = COLOR_SECONDARY;
    ctx.font = font(30);
    ctx.fillText(metric.label, columnX[index], 760);
  });

  drawChartPanel(
    ctx,
    CHART_PANEL_X,
    CHART_PANEL_TOP,
    CHART_PANEL_WIDTH,
    CHART_PANEL_HEIGHT,
    CHART_PANEL_RADIUS
  );
  drawXpBars(ctx, data, {
    chartTop: CHART_TOP,
    barHeight: CHART_BAR_HEIGHT,
    valueSize: 22,
    labelY: 1182,
    labelSize: 24,
  });
  if (!data.days.some((day) => day.xp > 0)) {
    drawChartEmptyNote(ctx, "这一周还没有得分", 1010);
  }

  drawCardFooter(ctx);
}

/** 时间卡:今日学习时长 + 分项/累计 + 七日时间堆叠图,不出现 XP 目标与等级。 */
function drawTimeStatsCard(ctx: CanvasRenderingContext2D, data: StatsCardData): void {
  drawCardBackground(ctx);
  drawCardHeader(ctx, data);

  const heroText = formatStudyDuration(data.todayStudy);
  const heroSize = fittedFontSize(
    ctx,
    heroText,
    150,
    CONTENT_WIDTH,
    "600",
    DISPLAY_STACK
  );
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR_INK;
  ctx.font = displayFont(heroSize);
  ctx.fillText(heroText, CENTER_X, 400);

  ctx.fillStyle = COLOR_SECONDARY;
  ctx.font = font(44);
  ctx.fillText("今日学习时长", CENTER_X, 468);

  drawFittedLine(
    ctx,
    `看讲解 ${formatStudyDuration(data.todayRead)} · 做练习 ${formatStudyDuration(
      data.todayPractice
    )}`,
    CENTER_X,
    550,
    CONTENT_WIDTH,
    36,
    "normal",
    COLOR_SECONDARY
  );

  // 法国金短线:把今日与累计分开。
  ctx.fillStyle = COLOR_GOLD;
  ctx.fillRect(CENTER_X - 48, 588, 96, 3);

  drawFittedLine(
    ctx,
    `累计学习 ${formatStudyDuration(data.studyTotal)}`,
    CENTER_X,
    648,
    CONTENT_WIDTH,
    42,
    "bold",
    COLOR_INK
  );
  drawFittedLine(
    ctx,
    `看讲解 ${formatStudyDuration(data.studyRead)} · 做练习 ${formatStudyDuration(
      data.studyPractice
    )}`,
    CENTER_X,
    698,
    CONTENT_WIDTH,
    30,
    "normal",
    COLOR_SECONDARY
  );

  drawChartPanel(
    ctx,
    CHART_PANEL_X,
    TIME_PANEL_TOP,
    CHART_PANEL_WIDTH,
    TIME_PANEL_HEIGHT,
    CHART_PANEL_RADIUS
  );

  ctx.textAlign = "left";
  ctx.fillStyle = COLOR_TEXT;
  ctx.font = font(27, "bold");
  ctx.fillText("最近 7 天学习时长（分钟）", MARGIN_X + 40, TIME_PANEL_TITLE_Y);
  drawStudyLegend(
    ctx,
    CHART_PANEL_X + CHART_PANEL_WIDTH - 40,
    TIME_PANEL_TITLE_Y
  );

  drawStudyBars(ctx, data, {
    chartTop: TIME_CHART_TOP,
    barHeight: TIME_CHART_BAR_HEIGHT,
    valueSize: 22,
    labelY: TIME_CHART_LABEL_Y,
    labelSize: 24,
  });
  if (!data.days.some((day) => day.studySeconds > 0)) {
    drawChartEmptyNote(ctx, "这一周还没有学习记录", 950);
  }

  drawCardFooter(ctx);
}

/** 都有卡:今日 XP 与时间并列,七日 XP/时间各用独立刻度。 */
function drawBothStatsCard(ctx: CanvasRenderingContext2D, data: StatsCardData): void {
  drawCardBackground(ctx);
  drawCardHeader(ctx, data);

  // 左:今日 XP
  const xpText = String(data.todayXp);
  const xpSize = fittedFontSize(
    ctx,
    xpText,
    180,
    BOTH_XP_MAX_WIDTH,
    "600",
    DISPLAY_STACK
  );
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR_INK;
  ctx.font = displayFont(xpSize);
  ctx.fillText(xpText, BOTH_XP_X, BOTH_HERO_BASELINE);

  ctx.fillStyle = COLOR_SECONDARY;
  ctx.font = font(34);
  ctx.fillText("今日 XP", BOTH_XP_X, BOTH_HERO_LABELS_Y);

  // 中间细分隔线,避免两个主视觉连读。
  ctx.fillStyle = COLOR_RULE;
  ctx.fillRect(CENTER_X - 1, 258, 2, 210);

  // 右:今日学习时长
  const timeText = formatStudyDuration(data.todayStudy);
  const timeSize = fittedFontSize(
    ctx,
    timeText,
    84,
    BOTH_TIME_MAX_WIDTH,
    "600",
    DISPLAY_STACK
  );
  ctx.fillStyle = COLOR_INK;
  ctx.font = displayFont(timeSize);
  ctx.fillText(timeText, BOTH_TIME_X, BOTH_HERO_BASELINE);

  ctx.fillStyle = COLOR_SECONDARY;
  ctx.font = font(34);
  ctx.fillText("今日学习时长", BOTH_TIME_X, BOTH_HERO_LABELS_Y);

  drawGoalBar(ctx, data, 520, 24, 578, 30);

  // 近七天 XP:独立 XP 刻度。
  drawChartPanel(
    ctx,
    CHART_PANEL_X,
    BOTH_PANEL_TOP,
    CHART_PANEL_WIDTH,
    BOTH_XP_PANEL_HEIGHT,
    24
  );
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR_TEXT;
  ctx.font = font(26, "bold");
  ctx.fillText("最近 7 天 XP", MARGIN_X + 40, BOTH_XP_TITLE_Y);
  drawXpBars(ctx, data, {
    chartTop: BOTH_XP_CHART_TOP,
    barHeight: BOTH_XP_CHART_BAR_HEIGHT,
    valueSize: 18,
    labelY: BOTH_XP_LABEL_Y,
    labelSize: 22,
  });
  if (!data.days.some((day) => day.xp > 0)) {
    drawChartEmptyNote(ctx, "这一周还没有得分", 770);
  }

  // 近七天学习时长:独立时间刻度(分钟),不与 XP 共用。
  drawChartPanel(
    ctx,
    CHART_PANEL_X,
    BOTH_STUDY_PANEL_TOP,
    CHART_PANEL_WIDTH,
    BOTH_STUDY_PANEL_HEIGHT,
    24
  );
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR_TEXT;
  ctx.font = font(26, "bold");
  ctx.fillText("最近 7 天学习时长（分钟）", MARGIN_X + 40, BOTH_STUDY_TITLE_Y);
  drawStudyLegend(
    ctx,
    CHART_PANEL_X + CHART_PANEL_WIDTH - 40,
    BOTH_STUDY_TITLE_Y
  );
  drawStudyBars(ctx, data, {
    chartTop: BOTH_STUDY_CHART_TOP,
    barHeight: BOTH_STUDY_CHART_BAR_HEIGHT,
    valueSize: 18,
    labelY: BOTH_STUDY_LABEL_Y,
    labelSize: 22,
  });
  if (!data.days.some((day) => day.studySeconds > 0)) {
    drawChartEmptyNote(ctx, "这一周还没有学习记录", 1040);
  }

  drawCardFooter(ctx);
}

/**
 * 按 2026-11-14 法国主题设计绘制 1080×1350 分享卡。
 * 固定浅色、不读取运行时 CSS 变量;数字与中文使用不同字体栈。
 */
export function drawStatsCard(ctx: CanvasRenderingContext2D, data: StatsCardData): void {
  ctx.textBaseline = "alphabetic";

  if (data.mode === "time") {
    drawTimeStatsCard(ctx, data);
    return;
  }
  if (data.mode === "both") {
    drawBothStatsCard(ctx, data);
    return;
  }
  drawXpStatsCard(ctx, data);
}

export function createStatsCardCanvas(data: StatsCardData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_CARD_WIDTH;
  canvas.height = SHARE_CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  drawStatsCard(ctx, data);
  return canvas;
}

export function statsCardBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas PNG export failed"));
    }, "image/png");
  });
}

export function statsCardBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}

export function statsCardFilename(date: string): string {
  return `fge-stats-${date}.png`;
}
