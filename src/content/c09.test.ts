// @vitest-environment node
import { CHAPTERS } from "../content";
import { judge } from "../engine";
import { completedQuestion } from "../answerFill";
import type { ChoiceQuestion } from "../types";

describe.skipIf(__FGE_EDITION__ !== "public")("public: C09 past tenses", () => {
  test("C09 follows C08 in the public chapter order", () => {
    expect(CHAPTERS.slice(0, 9).map((chapter) => chapter.id)).toEqual([
      "pub-c01-boundaries",
      "pub-c02-noun-phrases",
      "pub-c03-adjectives",
      "pub-c04-determiners",
      "pub-c05-present",
      "pub-c06-verbs",
      "pub-c07-negation-questions",
      "pub-c08-imperative-emphasis",
      "pub-c09-past-tenses",
    ]);
  });

  test("多空位 choice:选项分槽数与空数一致,正确项补全后无占位符或双空格", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c09-past-tenses");
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
    ["l1-q4", "écouté", "ecoute"],
    ["l1-q5", "joué", "joue"],
    ["l1-q6", "fermé", "ferme"],
    ["l1-q16", "fini", "finit"],
    ["l1-q24", "fait", "fais"],
    ["l2-q23", "née", "ne"],
    ["l2-q36", "allée", "alle"],
    ["l5-q3", "finissais", "finissait"],
    ["l5-q10", "étions", "etions"],
    ["l5-q13", "était", "etait"],
    ["l5-q26", "payions", "payons"],
    ["l5-q53", "buvions", "buvons"],
    ["l6-q6", "allions", "allons"],
    ["l7-q13", "avait", "avais"],
    ["x2-q4", "étaient", "etaient"],
  ])("%s accepts the target form and rejects the error", (suffix, good, bad) => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c09-past-tenses");
    const question = chapter && [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .find((item) => item.id === `pub-c09-past-tenses-${suffix}`);
    expect(question).toBeDefined();
    if (!question) return;
    expect(question.type).toBe("letters");
    expect(judge(question, good)).toBe(true);
    expect(judge(question, bad)).toBe(false);
  });
});
