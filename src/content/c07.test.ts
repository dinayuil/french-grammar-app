// @vitest-environment node
import { CHAPTERS } from "../content";
import { judge } from "../engine";
import { completedQuestion } from "../answerFill";
import type { ChoiceQuestion } from "../types";

describe.skipIf(__FGE_EDITION__ !== "public")("public: C07 negation and questions", () => {
  test("C07 follows C06 in the public chapter order", () => {
    expect(CHAPTERS.slice(0, 7).map((chapter) => chapter.id)).toEqual([
      "pub-c01-boundaries",
      "pub-c02-noun-phrases",
      "pub-c03-adjectives",
      "pub-c04-determiners",
      "pub-c05-present",
      "pub-c06-verbs",
      "pub-c07-negation-questions",
    ]);
  });

  test("多空位 choice:选项分槽数与空数一致,正确项补全后无占位符或双空格", () => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c07-negation-questions");
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
    ["l1-q12", "regardons", "regarde"],
    ["l1-q13", "aime", "aimes"],
    ["l1-q14", "sommes", "êtes"],
    ["l1-q15", "avons", "avez"],
    ["l1-q17", "très", "trés"],
    ["l1-q18", "peut", "peuvent"],
    ["l2-q12", "aucune", "aucun"],
    ["l3-q10", "une", "un"],
    ["l4-q7", "Aimes", "Aime"],
    ["l4-q15", "Parle", "Parles"],
    ["l4-q17", "Aime", "Aimes"],
    ["l4-q23", "Êtes", "Etes"],
    ["l5-q7", "Où", "Ou"],
    ["l6-q7", "chante", "chantes"],
    ["l6-q16", "que", "quoi"],
    ["l7-q3", "viens", "vient"],
  ])("%s accepts the target form and rejects the error", (suffix, good, bad) => {
    const chapter = CHAPTERS.find((item) => item.id === "pub-c07-negation-questions");
    const question = chapter && [...chapter.lessons, ...chapter.challenges]
      .flatMap((lesson) => lesson.questions)
      .find((item) => item.id === `pub-c07-negation-questions-${suffix}`);
    expect(question).toBeDefined();
    if (!question) return;
    expect(question.type).toBe("letters");
    expect(judge(question, good)).toBe(true);
    expect(judge(question, bad)).toBe(false);
  });
});
