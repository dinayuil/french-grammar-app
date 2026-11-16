import type { Chapter, Lesson, Question } from "../types";
import { CONTENT_LOCALES } from "../i18n/types";
import { parseLegacyBlankTarget } from "../answerFill";

const QUESTION_TYPES = new Set(["choice", "letters", "tiles"]);
const LESSON_KINDS = new Set(["lesson", "challenge"]);

const CHAPTER_LOCALE_FIELDS = new Set(["title", "sectionTitles"]);
const CARD_LOCALE_FIELDS = new Set(["title", "body"]);
const LESSON_LOCALE_FIELDS = new Set(["title"]);
const QUESTION_LOCALE_FIELDS = new Set([
  "prompt",
  "example",
  "explain",
  "translation",
]);

const LEGACY_BLANK_MARKER = /\(第\d+空\)/;
/** 与 answerFill.fillLetters 的补全锚点保持一致。 */
const LETTER_COMPLETION_ANCHOR = /___|\.\.\.|\((?:être|avoir)\)/;

export interface ValidateChapterOptions {
  /**
   * 允许出现在内容 `locales` 映射中的语言。默认使用产品注册表（首期仅
   * `fr`）；未来语言测试可显式扩展现有注册表，但不会进入产品选项。
   */
  contentLocales?: readonly string[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function blankTokens(text: string): string[] {
  return text.match(/___|\.\.\./g) ?? [];
}

function checkSectionTitles(
  id: string,
  locale: string,
  value: unknown,
  errs: string[]
): void {
  if (!isPlainObject(value)) {
    errs.push(`${id}: locales.${locale}.sectionTitles 必须是对象`);
    return;
  }
  for (const [key, title] of Object.entries(value)) {
    if (!key.trim()) {
      errs.push(`${id}: locales.${locale}.sectionTitles 含空小章 key`);
    }
    if (!isNonEmptyString(title)) {
      errs.push(
        `${id}: locales.${locale}.sectionTitles.${key} 必须是非空字符串`
      );
    }
  }
}

function checkLocalizedOptions(
  id: string,
  locale: string,
  value: unknown,
  question: Question | undefined,
  errs: string[]
): void {
  if (!question || question.type !== "choice") {
    errs.push(`${id}: locales.${locale}.options 仅 choice 可用`);
    return;
  }
  if (!Array.isArray(value)) {
    errs.push(`${id}: locales.${locale}.options 必须是数组`);
    return;
  }
  if (value.length !== question.options.length) {
    errs.push(
      `${id}: locales.${locale}.options 长度必须与原 options 相同（${question.options.length}）`
    );
    return;
  }
  if (value.some((option) => !isNonEmptyString(option))) {
    errs.push(`${id}: locales.${locale}.options 含非字符串或空项`);
  }
}

/**
 * 校验实体的 locales 映射：已注册语言、字段白名单、非空字符串，以及
 * choice 展示选项的长度和题干占位符序列。
 */
function checkLocaleFields(
  id: string,
  rawLocales: unknown,
  allowedFields: ReadonlySet<string>,
  registered: readonly string[],
  errs: string[],
  question?: Question
): void {
  if (rawLocales === undefined) return;
  if (!isPlainObject(rawLocales)) {
    errs.push(`${id}: locales 必须是对象`);
    return;
  }

  for (const [locale, rawFields] of Object.entries(rawLocales)) {
    if (!locale.trim()) {
      errs.push(`${id}: locales 含空语言值`);
      continue;
    }
    if (locale === "zh-CN") {
      errs.push(`${id}: locales.zh-CN 不允许，中文以原字段为准`);
      continue;
    }
    if (!registered.includes(locale)) {
      errs.push(`${id}: locales.${locale} 是非法或未注册语言值`);
      continue;
    }
    if (!isPlainObject(rawFields)) {
      errs.push(`${id}: locales.${locale} 必须是对象`);
      continue;
    }

    for (const [field, value] of Object.entries(rawFields)) {
      if (!allowedFields.has(field)) {
        errs.push(`${id}: locales.${locale} 不允许字段「${field}」`);
        continue;
      }
      if (field === "sectionTitles") {
        checkSectionTitles(id, locale, value, errs);
        continue;
      }
      if (field === "options") {
        checkLocalizedOptions(id, locale, value, question, errs);
        continue;
      }
      if (!isNonEmptyString(value)) {
        errs.push(
          `${id}: locales.${locale}.${field} 必须是非空字符串`
        );
        continue;
      }
      if (field === "prompt" && question) {
        if (LEGACY_BLANK_MARKER.test(value)) {
          errs.push(
            `${id}: locales.${locale}.prompt 不得包含旧空位标记（第N空）`
          );
        }
        const expected = blankTokens(question.prompt);
        const actual = blankTokens(value);
        const preserved =
          expected.length === actual.length &&
          expected.every((token, index) => token === actual[index]);
        if (!preserved) {
          errs.push(
            `${id}: locales.${locale}.prompt 必须保留原题干空位标记的数量与顺序`
          );
        }
        if (
          question.type === "letters" &&
          LETTER_COMPLETION_ANCHOR.test(question.prompt) &&
          !LETTER_COMPLETION_ANCHOR.test(value)
        ) {
          errs.push(
            `${id}: locales.${locale}.prompt 必须保留至少一个可识别补全锚点（___、...、(être) 或 (avoir)）`
          );
        }
      }
    }
  }
}

/**
 * 校验一章题库,返回错误列表(空数组 = 合法)。
 * 每条错误以「位置: 原因」描述,便于定位到具体 lesson/question。
 */
export function validateChapter(
  ch: Chapter,
  options: ValidateChapterOptions = {}
): string[] {
  const errs: string[] = [];
  const contentLocales = options.contentLocales ?? CONTENT_LOCALES;
  const seenIds = new Set<string>();
  const mark = (id: string) => {
    if (!id || typeof id !== "string") {
      errs.push("id 缺失或为空");
      return false;
    }
    if (seenIds.has(id)) {
      errs.push(`${id}: id 重复`);
      return false;
    }
    seenIds.add(id);
    return true;
  };

  if (!ch || typeof ch !== "object") return ["章节数据不是对象"];
  if (!ch.id) errs.push("章节缺 id");
  else mark(ch.id);
  if (!isNonEmptyString(ch.title)) errs.push(`${ch.id}: 章节 title 必须是非空字符串`);
  if (!isNonEmptyString(ch.titleFr)) errs.push(`${ch.id}: 章节 titleFr 必须是非空字符串`);
  if (!Array.isArray(ch.cards)) errs.push(`${ch.id}: cards 不是数组`);
  if (!Array.isArray(ch.lessons)) errs.push(`${ch.id}: lessons 不是数组`);
  if (!Array.isArray(ch.challenges)) errs.push(`${ch.id}: challenges 不是数组`);
  checkLocaleFields(
    ch.id,
    ch.locales,
    CHAPTER_LOCALE_FIELDS,
    contentLocales,
    errs
  );
  if (isPlainObject(ch.locales)) {
    const fr = ch.locales.fr;
    if (isPlainObject(fr) && Object.prototype.hasOwnProperty.call(fr, "title")) {
      errs.push(`${ch.id}: locales.fr.title 不允许，法语章名使用 titleFr`);
    }
  }
  if (errs.length > 0) return errs; // 结构已坏,继续检查没有意义

  const checkLesson = (l: Lesson) => {
    if (!l || typeof l !== "object") {
      errs.push("lesson 不是对象");
      return;
    }
    if (!mark(l.id)) return;
    if (!isNonEmptyString(l.title)) errs.push(`${l.id}: title 必须是非空字符串`);
    if (!isNonEmptyString(l.source)) errs.push(`${l.id}: source 必须是非空字符串(需注明来源)`);
    if (!LESSON_KINDS.has(l.kind)) errs.push(`${l.id}: kind 非法(${String(l.kind)}),只能 lesson/challenge`);
    checkLocaleFields(
      l.id,
      l.locales,
      LESSON_LOCALE_FIELDS,
      contentLocales,
      errs
    );
    if (!Array.isArray(l.questions) || l.questions.length === 0) {
      errs.push(`${l.id}: questions 为空`);
      return;
    }
    for (const q of l.questions) checkQuestion(q);
  };

  const checkQuestion = (q: Question) => {
    if (!q || typeof q !== "object") {
      errs.push("question 不是对象");
      return;
    }
    if (!mark(q.id)) return;
    if (!isNonEmptyString(q.prompt)) errs.push(`${q.id}: prompt 必须是非空字符串`);
    if (typeof q.explain !== "string") errs.push(`${q.id}: explain 缺失(需字符串)`);
    if (q.translation !== undefined && !isNonEmptyString(q.translation))
      errs.push(`${q.id}: translation 必须是非空字符串`);
    if (q.example !== undefined && !isNonEmptyString(q.example))
      errs.push(`${q.id}: example 必须是非空字符串`);
    if (!QUESTION_TYPES.has(q.type)) {
      errs.push(`${q.id}: type 非法(${String(q.type)})`);
      return;
    }
    if (q.type === "choice") {
      if (!Array.isArray(q.options)) {
        errs.push(`${q.id}: choice options 不是数组`);
        return;
      }
      if (q.options.some((o) => typeof o !== "string" || !o.trim()))
        errs.push(`${q.id}: choice options 含非字符串或空项`);
      const n = q.options.length;
      if (n < 2) errs.push(`${q.id}: choice 选项不足 2 个`);
      if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= n)
        errs.push(`${q.id}: choice answer 下标越界`);
      if (q.alternatives !== undefined) {
        if (!Array.isArray(q.alternatives)) {
          errs.push(`${q.id}: choice alternatives 不是数组`);
        } else {
          for (const a of q.alternatives)
            if (!Number.isInteger(a) || a < 0 || a >= n)
              errs.push(`${q.id}: choice alternatives 下标越界(${String(a)})`);
        }
      }
    }
    if (q.type === "letters") {
      if (typeof q.answer !== "string" || !q.answer.trim())
        errs.push(`${q.id}: letters answer 为空`);
      if (
        q.alternatives !== undefined &&
        (!Array.isArray(q.alternatives) ||
          q.alternatives.some((a) => typeof a !== "string" || !a.trim()))
      )
        errs.push(`${q.id}: letters alternatives 非法`);
      const optionalLetterFields: Array<[string, string[] | undefined]> = [
        ["accentKeys", q.accentKeys],
        ["decoys", q.decoys],
      ];
      for (const [field, values] of optionalLetterFields) {
        if (
          values !== undefined &&
          (!Array.isArray(values) ||
            values.some((v) => typeof v !== "string" || !v.trim()))
        )
          errs.push(`${q.id}: letters ${field} 非法`);
      }
    }
    if (q.type === "tiles") {
      if (!Array.isArray(q.answer) || q.answer.length === 0) {
        errs.push(`${q.id}: tiles answer 为空`);
      } else if (q.answer.some((w) => typeof w !== "string" || !w.trim())) {
        errs.push(`${q.id}: tiles answer 含非字符串或空词`);
      }
      if (!Array.isArray(q.bank)) {
        errs.push(`${q.id}: tiles bank 不是数组`);
      } else if (q.bank.length === 0) {
        errs.push(`${q.id}: tiles bank 为空`);
      } else if (q.bank.some((w) => typeof w !== "string" || !w.trim())) {
        errs.push(`${q.id}: tiles bank 含非字符串或空词`);
      } else if (Array.isArray(q.answer)) {
        const bank = new Set(q.bank);
        for (const w of q.answer)
          if (!bank.has(w)) errs.push(`${q.id}: tiles answer 词「${w}」不在 bank 中`);
      }
      if (q.alternatives !== undefined) {
        if (
          !Array.isArray(q.alternatives) ||
          q.alternatives.some(
            (seq) =>
              !Array.isArray(seq) ||
              seq.length === 0 ||
              seq.some((w) => typeof w !== "string" || !w.trim())
          )
        )
          errs.push(`${q.id}: tiles alternatives 非法`);
      }
    }

    if (q.type === "choice") {
      if (q.blankTarget !== undefined) {
        if (
          typeof q.blankTarget !== "number" ||
          !Number.isInteger(q.blankTarget) ||
          q.blankTarget < 1
        ) {
          errs.push(`${q.id}: choice blankTarget 必须是从 1 开始的整数`);
        } else {
          const blankCount = blankTokens(q.prompt).length;
          if (q.blankTarget > blankCount) {
            errs.push(
              `${q.id}: choice blankTarget 超出题干空位数量（${blankCount}）`
            );
          }
          const legacy = parseLegacyBlankTarget(q.prompt);
          if (legacy !== null && legacy !== q.blankTarget) {
            errs.push(
              `${q.id}: choice blankTarget 与旧标记 (第${legacy}空) 不一致`
            );
          }
        }
      }
    } else if (
      (q as unknown as Record<string, unknown>).blankTarget !== undefined
    ) {
      errs.push(`${q.id}: 只有 choice 支持 blankTarget`);
    }

    const localeFields = new Set(QUESTION_LOCALE_FIELDS);
    if (q.type === "choice") localeFields.add("options");
    checkLocaleFields(
      q.id,
      q.locales,
      localeFields,
      contentLocales,
      errs,
      q
    );
  };

  ch.lessons.forEach(checkLesson);
  ch.challenges.forEach(checkLesson);
  for (const c of ch.cards) {
    if (!c || typeof c !== "object") {
      errs.push("card 不是对象");
      continue;
    }
    if (!mark(c.id)) continue;
    if (!isNonEmptyString(c.title)) errs.push(`${c.id}: card title 必须是非空字符串`);
    if (!isNonEmptyString(c.body)) errs.push(`${c.id}: card body 必须是非空字符串`);
    checkLocaleFields(
      c.id,
      c.locales,
      CARD_LOCALE_FIELDS,
      contentLocales,
      errs
    );
  }
  return errs;
}
