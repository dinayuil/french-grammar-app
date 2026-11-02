// @vitest-environment node
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import process from "node:process";
import { CHAPTERS } from "../content";
import { completedQuestion } from "../answerFill";
import { validateChapter } from "./validate";
import type {
  Chapter,
  ChoiceQuestion,
  LettersQuestion,
  Question,
  TilesQuestion,
} from "../types";

const EDITION = __FGE_EDITION__;

function privateRoot(): string {
  const configured = process.env.FGE_INTERNAL_CONTENT_DIR;
  return configured
    ? resolve(process.cwd(), configured)
    : resolve(process.cwd(), "..", "content-private");
}

function publicRoot(): string {
  const configured = process.env.FGE_PUBLIC_CONTENT_DIR;
  return configured
    ? resolve(process.cwd(), configured)
    : resolve(process.cwd(), "..", "content-public");
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

function readPublicJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(publicRoot(), relativePath), "utf8")) as T;
}

function questionsOf(chapters: Chapter[]): Question[] {
  return chapters.flatMap((ch) => [...ch.lessons, ...ch.challenges]).flatMap((l) => l.questions);
}

function multiset(words: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
}

const ACCENTED_LETTER = /[À-ÖØ-öø-ÿ]/;

/**
 * 模拟当前字母题的输入能力:答案字母按多重集作为字母块,accentKeys
 * 可重复点击。备选答案若需要答案里没有的字母,只能来自 accentKeys。
 */
function lettersInputProblems(q: LettersQuestion): string[] {
  const problems: string[] = [];
  const accentKeys = new Set(q.accentKeys ?? []);
  const words: Array<{ label: string; value: string }> = [
    { label: "answer", value: q.answer },
    ...(q.alternatives ?? []).map((value, index) => ({
      label: `alternatives[${index}]`,
      value,
    })),
  ];

  for (const { label, value } of words) {
    if (/\s/.test(value)) {
      problems.push(`${q.id}: ${label} 含空格或空白 (${JSON.stringify(value)})`);
      continue;
    }
    const remaining = multiset([...q.answer]);
    for (const ch of value) {
      const available = remaining.get(ch) ?? 0;
      if (available > 0) {
        remaining.set(ch, available - 1);
      } else if (!accentKeys.has(ch)) {
        const accentNote = ACCENTED_LETTER.test(ch) ? "；必要重音也未出现在 accentKeys" : "";
        problems.push(`${q.id}: ${label} 字符「${ch}」无法输入${accentNote}`);
      }
    }
  }
  return problems;
}

function normalizeApostrophes(value: string): string {
  return value.normalize("NFC").replace(/\u2019/g, "'");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 以拉丁字母为词界,大小写不敏感。中文等非拉丁字符视为边界,所以
 * answer "a" 不会命中 "banana" 这类英文长词内部,但独立出现的
 * "a"/"A" 仍会被识别。
 */
function containsStandaloneFrenchWord(text: string, word: string): boolean {
  const source = `(?<!\\p{Script=Latin})${escapeRegExp(normalizeApostrophes(word))}(?!\\p{Script=Latin})`;
  return new RegExp(source, "iu").test(normalizeApostrophes(text));
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
 * public 分支只读取公开题库与公开 manifest 的相对路径;私库路径与
 * regressions 仅在 internal 分支访问,public 进程不会构造也不读取任何
 * 私有内容。数量从 manifest 读取,不写死章数/题数。
 */
describe.skipIf(EDITION !== "public")("public: 真实公开题库非空契约", () => {
  test("真实入口非空,所选 manifest 的 schema/计数与实际加载一致,全库 ID 唯一", () => {
    const manifest = readPublicJson<Manifest>("manifest.json");
    const questions = questionsOf(CHAPTERS);

    expect(CHAPTERS.length).toBeGreaterThan(0);
    expect(questions.length).toBeGreaterThan(0);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.edition).toBe("public");
    expect(manifest.expectedChapterCount).toBeGreaterThan(0);
    expect(manifest.expectedQuestionCount).toBeGreaterThan(0);
    expect(manifest.chapters).toHaveLength(CHAPTERS.length);
    expect(manifest.expectedChapterCount).toBe(CHAPTERS.length);
    expect(manifest.expectedQuestionCount).toBe(questions.length);

    const chapterIds = CHAPTERS.map((ch) => ch.id);
    const lessonIds = CHAPTERS.flatMap((ch) =>
      [...ch.lessons, ...ch.challenges].map((lesson) => lesson.id)
    );
    const questionIds = questions.map((q) => q.id);
    const cardIds = CHAPTERS.flatMap((ch) => ch.cards.map((card) => card.id));
    const allIds = [...chapterIds, ...lessonIds, ...questionIds, ...cardIds];

    expect(new Set(chapterIds).size).toBe(chapterIds.length);
    expect(new Set(lessonIds).size).toBe(lessonIds.length);
    expect(new Set(questionIds).size).toBe(questionIds.length);
    expect(new Set(cardIds).size).toBe(cardIds.length);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  test("每章通过 schema 且均有卡片/练习/综合挑战,每题翻译与解析非空", () => {
    expect(CHAPTERS.length).toBeGreaterThan(0);
    const schemaErrors = CHAPTERS.flatMap((ch) =>
      validateChapter(ch).map((error) => `${ch.id}: ${error}`)
    );
    expect(schemaErrors).toEqual([]);

    expect(CHAPTERS.filter((ch) => ch.cards.length === 0).map((ch) => ch.id)).toEqual([]);
    expect(CHAPTERS.filter((ch) => ch.lessons.length === 0).map((ch) => ch.id)).toEqual([]);
    expect(CHAPTERS.filter((ch) => ch.challenges.length === 0).map((ch) => ch.id)).toEqual([]);

    const questions = questionsOf(CHAPTERS);
    expect(questions.filter((q) => !isNonEmptyString(q.translation)).map((q) => q.id)).toEqual([]);
    expect(questions.filter((q) => !isNonEmptyString(q.explain)).map((q) => q.id)).toEqual([]);

    for (const q of questions) {
      const completed = completedQuestion(q);
      expect(completed.prompt.trim(), `${q.id}: 补全后的题干为空`).not.toBe("");
      if (q.type === "tiles") {
        expect(completed.target, `${q.id}: tiles 完整目标句不正确`).toBe(q.answer.join(" "));
      }
    }
  });

  test("多空位 choice 题无（第N空）标记时补全题干不残留占位符", () => {
    const multiBlank = questionsOf(CHAPTERS).filter((q): q is ChoiceQuestion => {
      if (q.type !== "choice") return false;
      const blanks = (q.prompt.match(/___|\.\.\./g) ?? []).length;
      return (
        blanks > 1 &&
        !/\(第\d+空\)/.test(q.prompt) &&
        q.options.every((option) => option.split(" / ").length === blanks)
      );
    });
    expect(multiBlank.length).toBeGreaterThan(0);

    const problems = multiBlank
      .map((q) => ({ id: q.id, prompt: completedQuestion(q).prompt }))
      .filter(({ prompt }) => /___|\.\.\./.test(prompt))
      .map(({ id, prompt }) => `${id}: 补全后残留占位符 ${JSON.stringify(prompt)}`);
    expect(problems).toEqual([]);
  });

  test("补块题 answer 与全部 alternatives 均可由 bank 多重集构造", () => {
    const tiles = questionsOf(CHAPTERS).filter(
      (q): q is TilesQuestion => q.type === "tiles"
    );
    expect(tiles.length).toBeGreaterThan(0);

    const problems: string[] = [];
    for (const q of tiles) {
      const bank = multiset(q.bank);
      const sequences: Array<{ label: string; value: string[] }> = [
        { label: "answer", value: q.answer },
        ...(q.alternatives ?? []).map((value, index) => ({
          label: `alternatives[${index}]`,
          value,
        })),
      ];
      for (const { label, value } of sequences) {
        const remaining = new Map(bank);
        for (const word of value) {
          const available = remaining.get(word) ?? 0;
          if (available === 0) {
            problems.push(`${q.id}: ${label} 词「${word}」超出 bank 多重集`);
          } else {
            remaining.set(word, available - 1);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test("字母题 answer 与 alternatives 无空格,所需字母和必要重音可输入", () => {
    const letters = questionsOf(CHAPTERS).filter(
      (q): q is LettersQuestion => q.type === "letters"
    );
    expect(letters.length).toBeGreaterThan(0);
    expect(letters.flatMap(lettersInputProblems)).toEqual([]);
  });

  test("字母题 translation 不以独立法文词直接泄露 answer/alternatives", () => {
    const letters = questionsOf(CHAPTERS).filter(
      (q): q is LettersQuestion => q.type === "letters"
    );
    expect(letters.length).toBeGreaterThan(0);

    const problems: string[] = [];
    for (const q of letters) {
      const translation = q.translation ?? "";
      const words = new Set([q.answer, ...(q.alternatives ?? [])]);
      for (const word of words) {
        if (containsStandaloneFrenchWord(translation, word)) {
          problems.push(`${q.id}: translation 直接包含独立词「${word}」`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test("章级及关卡级选择题不能固定同一答案位置", () => {
    const problems: string[] = [];
    for (const ch of CHAPTERS) {
      const choices = questionsOf([ch]).filter(
        (q): q is ChoiceQuestion => q.type === "choice"
      );
      const positions = new Set(choices.map((q) => q.answer));
      if (choices.length >= 8 && positions.size === 1) {
        problems.push(
          `${ch.id}: ${choices.length} 道 choice 的正确答案全部为索引 ${[...positions][0]}`
        );
      }
      for (const lesson of [...ch.lessons, ...ch.challenges]) {
        const questions = lesson.questions.filter((q) => q.type === "choice");
        if (questions.length >= 3 && new Set(questions.map((q) => q.answer)).size === 1) {
          problems.push(`${lesson.id}: 连续关卡内选择题答案位置固定`);
        }
      }
    }
    expect(problems).toEqual([]);
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
