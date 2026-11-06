// @vitest-environment node
import { CHAPTERS } from "../content";
import { judge } from "../engine";
import { completedQuestion } from "../answerFill";
import type { ChoiceQuestion } from "../types";

describe.skipIf(__FGE_EDITION__ !== "public")("public: C21 reported speech", () => {
  test("C21 follows C20 while existing public chapters remain available", () => {
    expect(CHAPTERS.slice(0, 21).map((chapter) => chapter.id)).toEqual([
      "pub-c01-boundaries",
      "pub-c02-noun-phrases",
      "pub-c03-adjectives",
      "pub-c04-determiners",
      "pub-c05-present",
      "pub-c06-verbs",
      "pub-c07-negation-questions",
      "pub-c08-imperative-emphasis",
      "pub-c09-past-tenses",
      "pub-c10-object-pronouns",
      "pub-c11-pronominal-verbs",
      "pub-c12-demonstrative-possessive-indefinite",
      "pub-c13-future-conditional",
      "pub-c14-relative-clauses",
      "pub-c15-comparison-adverbs",
      "pub-c16-time-space-prepositions",
      "pub-c17-passive-voice",
      "pub-c18-verb-complements",
      "pub-c19-subjunctive",
      "pub-c20-complex-sentences",
      "pub-c21-reported-speech",
    ]);
    expect(CHAPTERS.map((chapter) => chapter.id)).toEqual(
      expect.arrayContaining(["pub-predication", "pub-articles", "pub-agreement"]),
    );
  });

  test("每个关卡不超过 10 题", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c21-reported-speech");
    expect(chapter).toBeDefined();
    if (!chapter) return;
    for (const lesson of [...chapter.lessons, ...chapter.challenges]) {
      expect(lesson.questions.length).toBeLessThanOrEqual(10);
      expect(lesson.questions.length).toBeGreaterThan(0);
    }
  });

  test("多空位 choice:选项分槽数与空数一致,正确项补全后无占位符或双空格", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c21-reported-speech");
    expect(chapter).toBeDefined();
    if (!chapter) return;
    const multiBlank = [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .filter((item): item is ChoiceQuestion => {
        if (item.type !== "choice") return false;
        return (item.prompt.match(/___|\.\.\./g) ?? []).length > 1;
      });
    expect(multiBlank.length).toBeGreaterThan(0);

    const problems: string[] = [];
    for (const question of multiBlank) {
      const blanks = (question.prompt.match(/___|\.\.\./g) ?? []).length;
      for (const option of question.options) {
        const parts = option.split(" / ").length;
        if (parts !== blanks) {
          problems.push(`${question.id}: 选项「${option}」分槽 ${parts} ≠ 空数 ${blanks}`);
        }
      }
      const completed = completedQuestion(question).prompt;
      if (/___|\.\.\.|\s{2,}/.test(completed)) {
        problems.push(`${question.id}: 补全题干残留占位符或双空格 ${JSON.stringify(completed)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test.each([
    ["l1-q9", "venait", "vient"],
    ["l1-q10", "viendrait", "viendra"],
    ["l2-q9", "habitais", "habite"],
    ["l2-q10", "pouvais", "peux"],
    ["l5-q2", "viendras", "viendrais"],
    ["l5-q6", "arrivées", "arrivé"],
    ["x1-q11", "surlendemain", "lendemain"],
    ["x2-q5", "prise", "pris"],
  ])("%s accepts the target form and rejects the error", (suffix, good, bad) => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c21-reported-speech");
    const question = chapter && [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .find((item) => item.id === `pub-c21-reported-speech-${suffix}`);
    expect(question).toBeDefined();
    if (!question) return;
    expect(question.type).toBe("letters");
    expect(judge(question, good)).toBe(true);
    expect(judge(question, bad)).toBe(false);
  });
});
