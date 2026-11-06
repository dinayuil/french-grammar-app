import { DEFAULT_GOAL, STORAGE_KEY, LEGACY_STORAGE_KEY } from "./config";
import type { MistakeInfo, Progress } from "./types";

export const DEFAULT_PROGRESS: Progress = {
  xp: 0,
  dailyGoal: DEFAULT_GOAL,
  sound: true,
  translationEnabled: true,
  translationTiming: "before",
  days: {},
  lessons: {},
  mistakes: {},
};

function readKey(key: string): Progress | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Progress> & {
      lessons?: Record<string, Record<string, unknown>>;
      mistakes?: unknown;
    };
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

    // lessons:补齐 stars(v1 早期记录只有 perfect)
    const lessons: Progress["lessons"] = {};
    for (const [id, rec] of Object.entries(parsed.lessons ?? {})) {
      lessons[id] = {
        completed: !!rec.completed,
        stars: typeof rec.stars === "number" ? rec.stars : rec.perfect ? 3 : rec.completed ? 1 : 0,
      };
    }

    // mistakes:记录制;v1 是数组 → 迁移
    const mistakes: Record<string, MistakeInfo> = {};
    if (Array.isArray(parsed.mistakes)) {
      const t = today();
      for (const qid of parsed.mistakes) mistakes[qid] = { lastWrong: t, count: 1 };
    } else if (typeof parsed.mistakes === "object" && parsed.mistakes !== null) {
      for (const [qid, info] of Object.entries(parsed.mistakes as Record<string, Partial<MistakeInfo>>)) {
        if (info && typeof info.lastWrong === "string" && typeof info.count === "number") {
          mistakes[qid] = { lastWrong: info.lastWrong, count: info.count };
        }
      }
    }

    return {
      ...DEFAULT_PROGRESS,
      ...parsed,
      sound: typeof parsed.sound === "boolean" ? parsed.sound : true,
      translationEnabled:
        typeof parsed.translationEnabled === "boolean" ? parsed.translationEnabled : true,
      translationTiming:
        parsed.translationTiming === "before" || parsed.translationTiming === "after"
          ? parsed.translationTiming
          : "before",
      days: typeof parsed.days === "object" && parsed.days !== null ? parsed.days : {},
      lessons,
      mistakes,
    } as Progress;
  } catch {
    return null;
  }
}

/** 读进度:v2 优先;仅存在 legacy 键时自动迁移;任何异常兜底为默认值,绝不抛出。 */
export function loadProgress(): Progress {
  const current = readKey(STORAGE_KEY);
  if (current) return current;
  if (LEGACY_STORAGE_KEY !== null) {
    const legacy = readKey(LEGACY_STORAGE_KEY);
    if (legacy) return legacy;
  }
  return { ...DEFAULT_PROGRESS };
}

export function saveProgress(p: Progress): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

/** 本地日期 YYYY-MM-DD(不用 toISOString——那是 UTC,会在中国时区产生"昨天") */
export function today(): string {
  const now = new Date();
  return (
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0")
  );
}

/** 纯日期平移:date(YYYY-MM-DD)加减 delta 天,本地时区。 */
export function shiftDate(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return (
    dt.getFullYear() +
    "-" +
    String(dt.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(dt.getDate()).padStart(2, "0")
  );
}
