export interface BaseQuestion {
  id: string;
  prompt: string;
  explain: string;
  /** 中文翻译:句子题给整句,单词变形题给整组对应;可暂缺 */
  translation?: string;
  /** 题目组开头的范例;显示在题干上方 */
  example?: string;
}

export interface ChoiceQuestion extends BaseQuestion {
  type: "choice";
  options: string[];
  answer: number;
  /** 其他合法答案下标:与 answer 同等有效(判分通过、标绿/✓、不算错) */
  alternatives?: number[];
}

export interface LettersQuestion extends BaseQuestion {
  type: "letters";
  answer: string;
  alternatives?: string[];
  /** 可点击的重音字母键(如 é è ç) */
  accentKeys?: string[];
  /** 干扰字母(词库 = 答案字母 + decoys 洗牌) */
  decoys?: string[];
}

export interface TilesQuestion extends BaseQuestion {
  type: "tiles";
  answer: string[];
  alternatives?: string[][];
  /** 可选单词库(可含干扰词) */
  bank: string[];
}

export type Question = ChoiceQuestion | LettersQuestion | TilesQuestion;

export interface Lesson {
  id: string;
  title: string;
  kind: "lesson" | "challenge";
  /** 题目来源(教材页码、练习编号或“原创测试”),可回溯 */
  source: string;
  questions: Question[];
}

export interface Card {
  id: string;
  title: string;
  body: string;
}

export interface Chapter {
  id: string;
  title: string;
  titleFr: string;
  cards: Card[];
  lessons: Lesson[];
  challenges: Lesson[];
}

export interface DayRecord {
  xp: number;
  /** 当日已得 XP 的题目 id(每题每天只计一次) */
  earnedQids: string[];
  /** 当日已领过关/全对奖励的关卡 id("id" 过关、"id:perfect" 全对) */
  bonusIds: string[];
  /** 当天是否已提示过达标分享弹窗(旧数据缺省视为未提示) */
  sharePrompted?: boolean;
  /** 当天阅读学习时长(秒,旧数据缺省 0) */
  readSeconds?: number;
  /** 当天练习学习时长(秒,旧数据缺省 0) */
  practiceSeconds?: number;
}

export interface LessonRecord {
  completed: boolean;
  /** 历史最好星级 1-3(0 = 未完成) */
  stars: number;
}

/** 一道错题的记录:最后答错日期(用于"错得久优先")+ 累计答错次数 */
export interface MistakeInfo {
  lastWrong: string;
  count: number;
}

export interface Progress {
  xp: number;
  dailyGoal: number;
  /** 音效开关 */
  sound: boolean;
  /** 翻译开关 */
  translationEnabled: boolean;
  /** 翻译显示时机 */
  translationTiming: "before" | "after";
  days: Record<string, DayRecord>;
  lessons: Record<string, LessonRecord>;
  /** 当前错题(答对即移出) */
  mistakes: Record<string, MistakeInfo>;
}
