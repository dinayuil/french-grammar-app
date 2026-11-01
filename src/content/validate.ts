import type { Chapter, Lesson, Question } from "../types";

const QUESTION_TYPES = new Set(["choice", "letters", "tiles"]);
const LESSON_KINDS = new Set(["lesson", "challenge"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 校验一章题库,返回错误列表(空数组 = 合法)。
 * 每条错误以「位置: 原因」描述,便于定位到具体 lesson/question。
 */
export function validateChapter(ch: Chapter): string[] {
  const errs: string[] = [];
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
  }
  return errs;
}
