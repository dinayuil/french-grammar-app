/**
 * 展示字段的语言覆盖。键必须是已注册的内容语言（首期仅 `fr`），
 * 原字段始终代表中文；评分字段、ID、题型和来源不可覆盖。
 */
export interface QuestionLocaleFields {
  prompt?: string;
  example?: string;
  explain?: string;
  /** 该语言的句子译文；法语模式仍按显示策略隐藏 */
  translation?: string;
  /** 仅 choice 可用：展示选项，长度与顺序必须与 base.options 一致 */
  options?: string[];
}

export interface CardLocaleFields {
  title?: string;
  body?: string;
}

export interface LessonLocaleFields {
  title?: string;
}

export interface ChapterLocaleFields {
  /** 法语章名继续使用 titleFr，不允许 `locales.fr.title` */
  title?: string;
  /** 小章标题映射，键为 app 注册的小章 key */
  sectionTitles?: Record<string, string>;
}

export interface BaseQuestion {
  id: string;
  prompt: string;
  explain: string;
  /** 中文翻译:句子题给整句,单词变形题给整组对应;可暂缺 */
  translation?: string;
  /** 题目组开头的范例;显示在题干上方 */
  example?: string;
  /** 按语言覆盖展示文案；键在加载/构建时校验 */
  locales?: Record<string, QuestionLocaleFields>;
}

export interface ChoiceQuestion extends BaseQuestion {
  type: "choice";
  options: string[];
  answer: number;
  /** 其他合法答案下标:与 answer 同等有效(判分通过、标绿/✓、不算错) */
  alternatives?: number[];
  /**
   * 补全时只填的目标空位（从 1 开始）。仅 choice 可用；若原题干带
   * `(第N空)` 兼容标记，必须与其一致。评分仍使用 answer 下标。
   */
  blankTarget?: number;
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
  /** 按语言覆盖展示标题；来源不可覆盖 */
  locales?: Record<string, LessonLocaleFields>;
}

export interface Card {
  id: string;
  title: string;
  body: string;
  /** 按语言覆盖讲解卡片标题与正文 */
  locales?: Record<string, CardLocaleFields>;
}

export interface Chapter {
  id: string;
  title: string;
  titleFr: string;
  cards: Card[];
  lessons: Lesson[];
  challenges: Lesson[];
  /** 按语言覆盖章标题（法语除外）与小章标题 */
  locales?: Record<string, ChapterLocaleFields>;
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

/** 分享卡展示内容:经验、学习时间或两者都有 */
export type ShareCardContent = "xp" | "time" | "both";

export interface Progress {
  xp: number;
  dailyGoal: number;
  /** 音效开关 */
  sound: boolean;
  /** 翻译开关 */
  translationEnabled: boolean;
  /** 翻译显示时机 */
  translationTiming: "before" | "after";
  /** 分享卡展示内容,缺省 both */
  shareCardContent: ShareCardContent;
  days: Record<string, DayRecord>;
  lessons: Record<string, LessonRecord>;
  /** 当前错题(答对即移出) */
  mistakes: Record<string, MistakeInfo>;
}
