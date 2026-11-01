// @vitest-environment node
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import process from "node:process";
import { CHAPTERS } from "../content";
import { completedQuestion } from "../answerFill";
import { validateChapter } from "./validate";
import type { Chapter, Question } from "../types";

const EDITION = __FGE_EDITION__;

function privateRoot(): string {
  const configured = process.env.FGE_INTERNAL_CONTENT_DIR;
  return configured
    ? resolve(process.cwd(), configured)
    : resolve(process.cwd(), "..", "content-private");
}

interface Manifest {
  schemaVersion: number;
  edition: string;
  chapters: string[];
  expectedChapterCount: number;
  expectedQuestionCount: number;
}

interface QuestionAssertion {
  questionId: string;
  expected: Record<string, unknown>;
}

interface CardAssertion {
  cardId: string;
  expected: Record<string, unknown>;
}

interface Regressions {
  assertions: QuestionAssertion[];
  cardAssertions?: CardAssertion[];
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(privateRoot(), relativePath), "utf8")) as T;
}

function questionsOf(chapters: Chapter[]): Question[] {
  return chapters.flatMap((ch) => [...ch.lessons, ...ch.challenges]).flatMap((l) => l.questions);
}

const EXAMPLE_FIELD_SET = ["example"] as const;
const FULL_QUESTION_FIELD_SET = ["answer", "explain", "prompt", "translation", "type"] as const;
const CARD_FIELD_SET = ["title"] as const;
const QUESTION_TYPES = new Set(["choice", "letters", "tiles"]);

function sortedFields(record: Record<string, unknown>): string[] {
  return Object.keys(record).sort();
}

function fieldsEqual(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((field, i) => field === expected[i]);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 真实读取所选题库的入口测试。
 * public 分支只断言真实入口的空库;私库路径与 regressions 仅在 internal
 * 分支访问,public 进程不会构造也不读取任何私有内容。
 */
describe.skipIf(EDITION !== "public")("public: 真实所选库", () => {
  test("合法空库:CHAPTERS 为空数组,不 mock 虚拟模块", () => {
    expect(Array.isArray(CHAPTERS)).toBe(true);
    expect(CHAPTERS).toEqual([]);
  });
});

describe.skipIf(EDITION !== "internal")("internal: 真实私有题库", () => {
  test("30 章、4173 题,声明数量与真实数量一致", () => {
    expect(CHAPTERS).toHaveLength(30);
    expect(questionsOf(CHAPTERS)).toHaveLength(4173);
  });

  test("手册顺序、章节 id 与私有 manifest 一致,所有索引全局唯一", () => {
    const manifest = readJson<Manifest>("manifest.json");
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.edition).toBe("internal");
    expect(manifest.expectedChapterCount).toBe(30);
    expect(manifest.expectedQuestionCount).toBe(4173);
    expect(manifest.chapters).toHaveLength(30);

    const expectedIds = manifest.chapters.map((p) => basename(p, ".json"));
    expect(CHAPTERS.map((ch) => ch.id)).toEqual(expectedIds);

    const chapterIds = CHAPTERS.map((ch) => ch.id);
    expect(new Set(chapterIds).size).toBe(chapterIds.length);

    const lessonIds = CHAPTERS.flatMap((ch) => [...ch.lessons, ...ch.challenges].map((l) => l.id));
    expect(new Set(lessonIds).size).toBe(lessonIds.length);

    const questionIds = questionsOf(CHAPTERS).map((q) => q.id);
    expect(new Set(questionIds).size).toBe(questionIds.length);

    const cardIds = CHAPTERS.flatMap((ch) => ch.cards.map((c) => c.id));
    expect(new Set(cardIds).size).toBe(cardIds.length);
  });

  test("每章通过 validateChapter,每题都有翻译且能生成补全题干", () => {
    const bad = CHAPTERS.map((ch) => ({ id: ch.id, errs: validateChapter(ch) })).filter(
      (r) => r.errs.length > 0
    );
    expect(bad).toEqual([]);

    const missingTranslation = questionsOf(CHAPTERS)
      .filter((q) => !q.translation || !q.translation.trim())
      .map((q) => q.id);
    expect(missingTranslation).toEqual([]);

    for (const q of questionsOf(CHAPTERS)) {
      const completed = completedQuestion(q);
      if (q.type === "tiles") {
        expect(completed.target).toBeTruthy();
      } else {
        const blanks = (q.prompt.match(/___|\.\.\./g) ?? []).length;
        expect(completed.prompt).not.toMatch(/\(第\d+空\)|\((être|avoir)\)/);
        expect(completed.prompt).not.toMatch(/\s{2,}/);
        if (blanks <= 1) expect(completed.prompt).not.toMatch(/___|\.\.\./);
      }
    }
  });

  test("章节 3 结构:18 普通关 + 7 挑战关,均可定位", () => {
    const ch3 = CHAPTERS.find((ch) => ch.id === "ch3");
    expect(ch3).toBeDefined();
    expect(ch3!.lessons).toHaveLength(18);
    expect(ch3!.challenges).toHaveLength(7);
  });

  test("私有 regressions:78 题 + 1 卡片,逐字段与真实题库一致", () => {
    const regressions = readJson<Regressions>("regressions.json");
    expect(regressions.assertions).toHaveLength(78);
    expect(regressions.cardAssertions).toBeDefined();
    expect(regressions.cardAssertions).toHaveLength(1);

    const questionIndex = new Map(questionsOf(CHAPTERS).map((q) => [q.id, q] as const));
    const assertionIds = regressions.assertions.map((a) => a.questionId);
    expect(new Set(assertionIds).size).toBe(assertionIds.length);

    // 组别固定:75 条只校验 example,3 条校验完整题干字段;不允许空 expected
    // 或换一组字段来静默削弱内容回归。
    const questionFieldSets = regressions.assertions.map((a) => sortedFields(a.expected));
    const exampleOnly = questionFieldSets.filter((fields) => fieldsEqual(fields, EXAMPLE_FIELD_SET));
    const fullQuestions = questionFieldSets.filter((fields) => fieldsEqual(fields, FULL_QUESTION_FIELD_SET));
    expect(exampleOnly).toHaveLength(75);
    expect(fullQuestions).toHaveLength(3);
    expect(exampleOnly.length + fullQuestions.length).toBe(regressions.assertions.length);

    for (const assertion of regressions.assertions) {
      const question = questionIndex.get(assertion.questionId);
      expect(question, `missing question ${assertion.questionId}`).toBeDefined();
      const actual = question as unknown as Record<string, unknown>;
      const fields = sortedFields(assertion.expected);
      const exampleFields = fieldsEqual(fields, EXAMPLE_FIELD_SET);
      const fullQuestionFields = fieldsEqual(fields, FULL_QUESTION_FIELD_SET);
      expect(exampleFields || fullQuestionFields, `${assertion.questionId}: unexpected expected field set ${fields.join(",") || "<empty>"}`).toBe(true);

      if (exampleFields) {
        expect(isNonEmptyString(assertion.expected.example), `${assertion.questionId}: example 必须是非空字符串`).toBe(true);
      } else {
        expect(isNonEmptyString(assertion.expected.prompt), `${assertion.questionId}: prompt 必须是非空字符串`).toBe(true);
        expect(typeof assertion.expected.explain, `${assertion.questionId}: explain 必须是字符串`).toBe("string");
        expect(isNonEmptyString(assertion.expected.translation), `${assertion.questionId}: translation 必须是非空字符串`).toBe(true);
        expect(QUESTION_TYPES.has(String(assertion.expected.type)), `${assertion.questionId}: type 非法`).toBe(true);
        const type = assertion.expected.type;
        if (type === "choice") {
          expect(Number.isInteger(assertion.expected.answer), `${assertion.questionId}: choice answer 必须是整数`).toBe(true);
        } else if (type === "letters") {
          expect(isNonEmptyString(assertion.expected.answer), `${assertion.questionId}: letters answer 必须是非空字符串`).toBe(true);
        } else {
          expect(
            Array.isArray(assertion.expected.answer) &&
              assertion.expected.answer.length > 0 &&
              assertion.expected.answer.every(isNonEmptyString),
            `${assertion.questionId}: tiles answer 必须是非空字符串数组`
          ).toBe(true);
        }
      }

      for (const [field, expected] of Object.entries(assertion.expected)) {
        expect(actual[field], `${assertion.questionId}.${field}`).toEqual(expected);
      }
    }

    const cardIndex = new Map(CHAPTERS.flatMap((ch) => ch.cards).map((c) => [c.id, c] as const));
    const cardIds = regressions.cardAssertions!.map((a) => a.cardId);
    expect(new Set(cardIds).size).toBe(cardIds.length);
    const cardFieldSets = regressions.cardAssertions!.map((a) => sortedFields(a.expected));
    expect(cardFieldSets).toHaveLength(1);
    expect(fieldsEqual(cardFieldSets[0], CARD_FIELD_SET)).toBe(true);

    for (const assertion of regressions.cardAssertions!) {
      const card = cardIndex.get(assertion.cardId);
      expect(card, `missing card ${assertion.cardId}`).toBeDefined();
      const actual = card as unknown as Record<string, unknown>;
      const fields = sortedFields(assertion.expected);
      expect(fieldsEqual(fields, CARD_FIELD_SET), `${assertion.cardId}: unexpected card expected field set ${fields.join(",") || "<empty>"}`).toBe(true);
      expect(isNonEmptyString(assertion.expected.title), `${assertion.cardId}: title 必须是非空字符串`).toBe(true);
      for (const [field, expected] of Object.entries(assertion.expected)) {
        expect(actual[field], `${assertion.cardId}.${field}`).toEqual(expected);
      }
    }
  });
});
