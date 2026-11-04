import { levelFor, streakFor } from "../engine";
import { shiftDate } from "../storage";
import type { Progress } from "../types";

export const SHARE_CARD_WIDTH = 1080;
export const SHARE_CARD_HEIGHT = 1350;

export interface StatsCardDay {
  date: string;
  label: string;
  xp: number;
  isToday: boolean;
}

export interface StatsCardData {
  date: string;
  dateLabel: string;
  todayXp: number;
  goal: number;
  goalPercent: number;
  streak: number;
  level: number;
  totalXp: number;
  days: StatsCardDay[];
  maxXp: number;
}

const FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';

// 固定品牌浅色 palette:分享卡不跟随应用主题。
const COLOR_BG_TOP = "#f0fff0";
const COLOR_BG_BOTTOM = "#e8ffd6";
const COLOR_PRIMARY = "#2f6b00";
const COLOR_SECONDARY = "#6e6e6e";
const COLOR_GREEN = "#58cc02";
const COLOR_GOLD = "#ffc800";
const COLOR_TRACK = "#e5e5e5";

const MARGIN_X = 80;
const CONTENT_WIDTH = SHARE_CARD_WIDTH - MARGIN_X * 2;
const CHART_TOP = 880;
const CHART_BAR_HEIGHT = 260; // 含数值/日期标签的整块高度约 320
const BAR_WIDTH = 108;
const BAR_GAP = 24;
const BAR_COUNT = 7;
const CHART_WIDTH = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP;
const CHART_LEFT = MARGIN_X + (CONTENT_WIDTH - CHART_WIDTH) / 2;
const CHART_BOTTOM = CHART_TOP + CHART_BAR_HEIGHT;

const font = (size: number, weight: "normal" | "bold" = "normal") =>
  `${weight} ${size}px ${FONT_STACK}`;

function formatDateLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

function shortDateLabel(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${month}/${day}`;
}

/** 纯数据:最近 7 天(含 date)、今日 XP、目标进度、连击、等级与总 XP。 */
export function buildStatsCardData(progress: Progress, date: string): StatsCardData {
  const days: StatsCardDay[] = [];
  for (let offset = -6; offset <= 0; offset += 1) {
    const dayDate = shiftDate(date, offset);
    days.push({
      date: dayDate,
      label: offset === 0 ? "今天" : shortDateLabel(dayDate),
      xp: progress.days[dayDate]?.xp ?? 0,
      isToday: offset === 0,
    });
  }

  const todayXp = progress.days[date]?.xp ?? 0;
  const goal = progress.dailyGoal;

  return {
    date,
    dateLabel: formatDateLabel(date),
    todayXp,
    goal,
    goalPercent: goal > 0 ? Math.min(100, Math.round((todayXp / goal) * 100)) : 0,
    streak: streakFor(progress.days, goal, date),
    level: levelFor(progress.xp),
    totalXp: progress.xp,
    days,
    maxXp: Math.max(1, ...days.map((d) => d.xp)),
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

/** 按视觉规范 3.2/3.6 绘制 1080×1350 分享卡;不读取 CSS 变量。 */
export function drawStatsCard(ctx: CanvasRenderingContext2D, data: StatsCardData): void {
  const centerX = SHARE_CARD_WIDTH / 2;
  ctx.textBaseline = "alphabetic";

  // 背景渐变
  const gradient = ctx.createLinearGradient(0, 0, 0, SHARE_CARD_HEIGHT);
  gradient.addColorStop(0, COLOR_BG_TOP);
  gradient.addColorStop(1, COLOR_BG_BOTTOM);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

  // 顶部装饰线
  ctx.fillStyle = COLOR_GREEN;
  ctx.fillRect(MARGIN_X, 205, CONTENT_WIDTH, 1);

  // Wordmark + 日期
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR_PRIMARY;
  ctx.font = font(32, "bold");
  ctx.fillText("法语语法练习", MARGIN_X, 130);

  ctx.fillStyle = COLOR_SECONDARY;
  ctx.font = font(36);
  ctx.fillText(data.dateLabel, MARGIN_X, 170);

  // 今日 XP 主视觉
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR_PRIMARY;
  ctx.font = font(220, "bold");
  ctx.fillText(String(data.todayXp), centerX, 380);

  ctx.fillStyle = COLOR_SECONDARY;
  ctx.font = font(44);
  ctx.fillText("今日 XP", centerX, 450);

  // 目标进度条
  const barY = 520;
  const barHeight = 28;
  ctx.fillStyle = COLOR_TRACK;
  fillRoundRect(ctx, MARGIN_X, barY, CONTENT_WIDTH, barHeight, barHeight / 2);

  if (data.goalPercent > 0) {
    ctx.fillStyle = data.goalPercent >= 100 ? COLOR_GOLD : COLOR_GREEN;
    fillRoundRect(
      ctx,
      MARGIN_X,
      barY,
      (CONTENT_WIDTH * data.goalPercent) / 100,
      barHeight,
      barHeight / 2
    );
  }

  ctx.textAlign = "center";
  ctx.fillStyle = COLOR_SECONDARY;
  ctx.font = font(32);
  ctx.fillText(
    data.goal > 0
      ? `目标 ${data.goal} XP · 已完成 ${data.goalPercent}%`
      : "未设置每日目标",
    centerX,
    596
  );

  // 三指标行
  const metrics = [
    { value: data.streak, label: "连击天数" },
    { value: data.level, label: "等级" },
    { value: data.totalXp, label: "累计 XP" },
  ];
  const columnX = [
    MARGIN_X + CONTENT_WIDTH / 6,
    centerX,
    MARGIN_X + (CONTENT_WIDTH * 5) / 6,
  ];
  metrics.forEach((metric, index) => {
    ctx.fillStyle = COLOR_PRIMARY;
    ctx.font = font(72, "bold");
    ctx.fillText(String(metric.value), columnX[index], 710);

    ctx.fillStyle = COLOR_SECONDARY;
    ctx.font = font(30);
    ctx.fillText(metric.label, columnX[index], 760);
  });

  // 7 天柱状图
  data.days.forEach((day, index) => {
    const x = CHART_LEFT + index * (BAR_WIDTH + BAR_GAP);
    ctx.fillStyle = COLOR_TRACK;
    fillRoundRect(ctx, x, CHART_TOP, BAR_WIDTH, CHART_BAR_HEIGHT, 8);

    const height = Math.max(
      2,
      Math.min(CHART_BAR_HEIGHT, (day.xp / data.maxXp) * CHART_BAR_HEIGHT)
    );
    const y = CHART_BOTTOM - height;
    ctx.fillStyle = day.isToday ? COLOR_GOLD : COLOR_GREEN;
    fillRoundRect(ctx, x, y, BAR_WIDTH, height, 8);

    if (day.xp > 0) {
      ctx.fillStyle = COLOR_PRIMARY;
      ctx.font = font(22);
      ctx.textAlign = "center";
      ctx.fillText(String(day.xp), x + BAR_WIDTH / 2, y - 8);
    }

    ctx.fillStyle = COLOR_SECONDARY;
    ctx.font = font(24);
    ctx.textAlign = "center";
    ctx.fillText(day.label, x + BAR_WIDTH / 2, CHART_BOTTOM + 42);
  });

  // 底部 branding
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR_SECONDARY;
  ctx.font = font(30);
  ctx.fillText("每天练一点法语语法", centerX, 1228);

  ctx.fillStyle = COLOR_PRIMARY;
  ctx.font = font(24);
  ctx.fillText("法语语法练习", centerX, 1258);
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
