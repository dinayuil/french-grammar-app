import type {
  ChoiceQuestion,
  DayRecord,
  LettersQuestion,
  MistakeInfo,
  Progress,
  Question,
  TilesQuestion,
} from "./types";
import {
  XP_PER_CORRECT,
  XP_REDO_CORRECT,
  XP_LESSON_BONUS,
  XP_PERFECT_BONUS,
  XP_CHALLENGE_BONUS,
  XP_PER_LEVEL,
} from "./config";

/** 归一化:去首尾空白、合并连续空白、弯撇号→直撇号。不动大小写与重音(法语 é ≠ e)。 */
export function normalizeText(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .trim()
    .replace(/\s+/g, " ");
}

function eqText(a: string, b: string): boolean {
  return normalizeText(a) === normalizeText(b);
}

/**
 * choice 题的合法答案下标集合。answer 与 alternatives 全部是正式认可的正确答案:
 * 判分同样通过,判分后全部标绿/✓,选中任一合法选项都不算错。
 */
export function acceptedChoiceIndices(q: ChoiceQuestion): Set<number> {
  return new Set([q.answer, ...(q.alternatives ?? [])]);
}

/** 判分:choice 比下标;letters/tiles 先归一化,再依次比较 answer 与 alternatives。 */
export function judge(q: Question, response: number | string | string[]): boolean {
  switch (q.type) {
    case "choice": {
      if (typeof response !== "number") return false;
      return acceptedChoiceIndices(q).has(response);
    }
    case "letters": {
      if (typeof response !== "string") return false;
      if (eqText(response, q.answer)) return true;
      return q.alternatives?.some((a) => eqText(response, a)) ?? false;
    }
    case "tiles": {
      if (!Array.isArray(response)) return false;
      const same = (seq: string[]) =>
        seq.length === response.length && seq.every((w, i) => eqText(w, response[i]));
      if (same(q.answer)) return true;
      return q.alternatives?.some(same) ?? false;
    }
  }
}

const emptyDay = (): DayRecord => ({ xp: 0, earnedQids: [], bonusIds: [] });

/** 复习关选题:错得最久(lastWrong 最早)的优先,每关最多 max 题。 */
export function reviewQueue(
  mistakes: Record<string, MistakeInfo>,
  max = 10
): string[] {
  return Object.entries(mistakes)
    .sort(([, a], [, b]) => (a.lastWrong < b.lastWrong ? -1 : a.lastWrong > b.lastWrong ? 1 : 0))
    .slice(0, max)
    .map(([qid]) => qid);
}

/** 答一题:答对且当日未得过该题分 → 加 XP 并移出错题本;答错 → 记入错题本(count 累计)。immutable。 */
export function applyAnswer(
  progress: Progress,
  today: string,
  qid: string,
  correct: boolean,
  redo = false
): Progress {
  const prev = progress.days[today] ?? emptyDay();
  let gained = 0;
  let earnedQids = prev.earnedQids;
  let mistakes = progress.mistakes;
  if (correct) {
    if (!prev.earnedQids.includes(qid)) {
      gained = redo ? XP_REDO_CORRECT : XP_PER_CORRECT;
      earnedQids = [...prev.earnedQids, qid];
    }
    // 答对即移出错题本(复习/重做/重刷通用)
    if (mistakes[qid]) {
      mistakes = { ...mistakes };
      delete mistakes[qid];
    }
  } else {
    const prevM = mistakes[qid];
    mistakes = { ...mistakes, [qid]: { lastWrong: today, count: (prevM?.count ?? 0) + 1 } };
  }
  const day: DayRecord = { ...prev, xp: prev.xp + gained, earnedQids };
  return {
    ...progress,
    xp: progress.xp + gained,
    days: { ...progress.days, [today]: day },
    mistakes,
  };
}

/** 过关结算:过关奖(+5/+10)与全对奖(+5,会话全对时),同一天同关各只领一次;星级取历史最好。 */
export function applyLessonComplete(
  progress: Progress,
  today: string,
  lessonId: string,
  kind: "lesson" | "challenge",
  mistakesThisRun: number,
  stars: number
): Progress {
  const prev = progress.days[today] ?? emptyDay();
  const perfectNow = mistakesThisRun === 0;
  let gained = 0;
  let bonusIds = prev.bonusIds;
  if (!bonusIds.includes(lessonId)) {
    gained += kind === "challenge" ? XP_CHALLENGE_BONUS : XP_LESSON_BONUS;
    bonusIds = [...bonusIds, lessonId];
  }
  const perfectKey = lessonId + ":perfect";
  if (perfectNow && !bonusIds.includes(perfectKey)) {
    gained += XP_PERFECT_BONUS;
    bonusIds = [...bonusIds, perfectKey];
  }
  const prevLesson = progress.lessons[lessonId] ?? { completed: false, stars: 0 };
  const day: DayRecord = { ...prev, xp: prev.xp + gained, bonusIds };
  return {
    ...progress,
    xp: progress.xp + gained,
    days: { ...progress.days, [today]: day },
    lessons: {
      ...progress.lessons,
      [lessonId]: {
        completed: true,
        stars: Math.max(prevLesson.stars, stars),
      },
    },
  };
}

/** 标记当天已提示过达标分享(达标弹窗/统计页手动分享);immutable,保留当天已有记录。 */
export function markSharePrompted(progress: Progress, date: string): Progress {
  const prev = progress.days[date];
  if (prev?.sharePrompted) return progress;
  const day: DayRecord = { ...(prev ?? emptyDay()), sharePrompted: true };
  return { ...progress, days: { ...progress.days, [date]: day } };
}

export type StudyKind = "read" | "practice";

/** 累加当天学习时长(秒);seconds <= 0 不记录,原样返回。immutable,保留当天其他字段。 */
export function addStudySeconds(
  progress: Progress,
  date: string,
  kind: StudyKind,
  seconds: number
): Progress {
  if (seconds <= 0) return progress;
  const prev = progress.days[date] ?? emptyDay();
  const field = kind === "read" ? "readSeconds" : "practiceSeconds";
  const day: DayRecord = { ...prev, [field]: (prev[field] ?? 0) + Math.round(seconds) };
  return { ...progress, days: { ...progress.days, [date]: day } };
}

/** 汇总所有天数的学习时长(秒);缺字段或非数字按 0 处理。 */
export function studyTotals(
  days: Record<string, DayRecord>
): { read: number; practice: number; total: number } {
  let read = 0;
  let practice = 0;
  for (const d of Object.values(days)) {
    read += typeof d.readSeconds === "number" ? d.readSeconds : 0;
    practice += typeof d.practiceSeconds === "number" ? d.practiceSeconds : 0;
  }
  return { read, practice, total: read + practice };
}

/** 星级:会话全对(含重做补救)→ 3 星;首次正确率 ≥ 80% → 2 星;完成 → 1 星。 */
export function starsFor(correct: number, total: number, allFixed: boolean): number {
  if (allFixed || (total > 0 && correct === total)) return 3;
  if (total > 0 && correct / total >= 0.8) return 2;
  return 1;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 字母题词库:答案字母 + 干扰字母(decoys),按题 id 确定性洗牌(重渲染不抖动、可测试)。 */
export function lettersBank(q: LettersQuestion): string[] {
  const chars = [...q.answer, ...(q.decoys ?? [])];
  const rand = mulberry32(hash(q.id));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
}

/** 词块题词库:把整份 bank(答案词+干扰词)按题 id 确定性洗牌,避免直接暴露答案词序。 */
export function tilesBank(q: TilesQuestion): string[] {
  const words = [...q.bank];
  const rand = mulberry32(hash(q.id));
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  // 极短词库洗牌后可能仍是原顺序;旋转一位,确保不直接按答案顺序陈列
  if (words.length > 1 && words.every((w, i) => w === q.bank[i])) {
    words.push(words.shift()!);
  }
  return words;
}

/** 干扰字母池:全字母 + 法语重音字母 */
const LETTER_POOL = "abcdefghijklmnopqrstuvwxyzéèêàâîôûùëïç";

/** 干扰字母数量(用户定案):统一 3 个;答案太短时补到"答案+干扰 ≥ 5"。 */
export function decoyCount(answer: string): number {
  return Math.max(3, 5 - [...answer].length);
}

/** 随机抽取干扰字母(rng 可注入以便测试;运行时传 Math.random)。 */
export function pickDecoys(answer: string, rng: () => number): string[] {
  const n = decoyCount(answer);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(LETTER_POOL[Math.floor(rng() * LETTER_POOL.length)]);
  }
  return out;
}

function dayBefore(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d - 1);
  return (
    dt.getFullYear() +
    "-" +
    String(dt.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(dt.getDate()).padStart(2, "0")
  );
}

/** 连击:从今天(若达标)往前数连续达标天数;今天欠账不清昨天的连击。 */
export function streakFor(
  days: Record<string, DayRecord>,
  goal: number,
  today: string
): number {
  if (goal <= 0) return 0;
  const met = (d: string) => (days[d]?.xp ?? 0) >= goal;
  let cursor = met(today) ? today : dayBefore(today);
  let count = 0;
  while (met(cursor)) {
    count += 1;
    cursor = dayBefore(cursor);
  }
  return count;
}

/** 等级:每 100 XP 升一级,从 1 起。 */
export function levelFor(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}
