import type { Card, Chapter, Lesson, Question } from "../types";
import { CONTENT_LOCALES } from "../i18n/types";
import { resolveBlankTarget } from "../answerFill";

/**
 * 内容本地化注册表。默认只读取产品支持的内容语言（首期 `fr`）；
 * 未来语言测试可显式扩展，生产选项不受测试夹具影响。
 */
export interface LocalizeOptions {
  contentLocales?: readonly string[];
}

export interface CardDisplay {
  /** 原卡片实体；不得被展示模型修改 */
  base: Card;
  title: string;
  body: string;
}

export interface QuestionDisplay {
  /** 原题目实体：评分、进度和错题复习继续使用该引用 */
  base: Question;
  prompt: string;
  example?: string;
  explain: string;
  /** 当前语言可展示的句子译文；法语模式固定为 null */
  translation: string | null;
  /** choice 展示选项：与 base.options 等长同序；非 choice 为 undefined */
  options?: readonly string[];
  /** 补全目标空位（1-based）；界面据此生成本地化提示 */
  blankTarget: number | null;
}

export interface LessonDisplay {
  /** 原关卡实体；题目顺序与 ID 保持不变 */
  base: Lesson;
  title: string;
  questions: readonly QuestionDisplay[];
}

export interface ChapterDisplay {
  /** 原章节实体；首页展开状态等仍以该稳定对象为身份 */
  base: Chapter;
  title: string;
  /** 当前语言的小章标题映射；未覆盖的 key 由调用方回退旧中文标题 */
  sectionTitles: Readonly<Record<string, string>>;
  cards: readonly CardDisplay[];
  lessons: readonly LessonDisplay[];
  challenges: readonly LessonDisplay[];
}

export interface TranslationPreference {
  enabled: boolean;
  timing: "before" | "after";
}

function usesLocaleOverrides(
  locale: string,
  options: LocalizeOptions
): boolean {
  const registered = options.contentLocales ?? CONTENT_LOCALES;
  return locale !== "zh-CN" && registered.includes(locale);
}

function fieldsFor<T>(
  entity: { locales?: Record<string, T> },
  locale: string,
  options: LocalizeOptions
): T | undefined {
  if (!usesLocaleOverrides(locale, options)) return undefined;
  return entity.locales?.[locale];
}

function localizedOptions(
  question: Question & { type: "choice" },
  locale: string,
  override: readonly string[] | undefined
): readonly string[] {
  if (!override) return question.options;
  if (override.length !== question.options.length) {
    throw new Error(
      `${question.id}: locales.${locale}.options 长度与 base.options 不一致`
    );
  }
  return override;
}

export function localizeCard(
  card: Card,
  locale: string,
  options: LocalizeOptions = {}
): CardDisplay {
  const fields = fieldsFor(card, locale, options);
  return {
    base: card,
    title: fields?.title ?? card.title,
    body: fields?.body ?? card.body,
  };
}

export function localizeQuestion(
  question: Question,
  locale: string,
  options: LocalizeOptions = {}
): QuestionDisplay {
  const fields = fieldsFor(question, locale, options);
  const localized = usesLocaleOverrides(locale, options);
  return {
    base: question,
    prompt: fields?.prompt ?? question.prompt,
    example: fields?.example ?? question.example,
    explain: fields?.explain ?? question.explain,
    // 先按法语模式隐藏：法语译文属于目标语，不受 contentLocales 注册影响；
    // 其他语言只取该语言的覆盖，缺失时保持 null，绝不把中文标成该语言。
    translation:
      locale === "fr"
        ? null
        : !localized
          ? question.translation ?? null
          : fields?.translation ?? null,
    options:
      question.type === "choice"
        ? [...localizedOptions(question, locale, fields?.options)]
        : undefined,
    blankTarget:
      question.type === "choice" ? resolveBlankTarget(question) : null,
  };
}

export function localizeLesson(
  lesson: Lesson,
  locale: string,
  options: LocalizeOptions = {}
): LessonDisplay {
  const fields = fieldsFor(lesson, locale, options);
  return {
    base: lesson,
    title: fields?.title ?? lesson.title,
    questions: lesson.questions.map((question) =>
      localizeQuestion(question, locale, options)
    ),
  };
}

export function localizeChapter(
  chapter: Chapter,
  locale: string,
  options: LocalizeOptions = {}
): ChapterDisplay {
  const fields = fieldsFor(chapter, locale, options);
  return {
    base: chapter,
    // 法语章名继续使用现有 titleFr；其余语言才读取 locales.title。
    title: locale === "fr" ? chapter.titleFr : fields?.title ?? chapter.title,
    sectionTitles: { ...(fields?.sectionTitles ?? {}) },
    cards: chapter.cards.map((card) => localizeCard(card, locale, options)),
    lessons: chapter.lessons.map((lesson) =>
      localizeLesson(lesson, locale, options)
    ),
    challenges: chapter.challenges.map((lesson) =>
      localizeLesson(lesson, locale, options)
    ),
  };
}

/** 小章标题：当前语言有映射时使用映射，否则回退 app 旧中文标题。 */
export function sectionTitleForDisplay(
  display: ChapterDisplay,
  sectionKey: string,
  legacyTitle: string
): string {
  return display.sectionTitles[sectionKey] ?? legacyTitle;
}

/**
 * 句子译文的显示决定：统一处理翻译开关、答题前/后时机与法语隐藏。
 * 题目展示模型已按当前语言解析译文，法语为 null。
 */
export function translationForDisplay(
  display: QuestionDisplay,
  preference: TranslationPreference,
  answered: boolean
): string | null {
  if (!display.translation) return null;
  if (!preference.enabled) return null;
  if (preference.timing === "after" && !answered) return null;
  return display.translation;
}
